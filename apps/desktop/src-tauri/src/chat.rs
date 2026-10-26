//! Device-local subprocess ownership. Synced cards cannot name executables or start work.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    io::{BufRead, BufReader, Read, Write},
    path::PathBuf,
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use tauri::Emitter;
mod codex;
use codex::InputRequest;

const MAX_INPUT: usize = 640_000; // UTF-8 bytes; TS additionally limits UTF-16 characters.
const MAX_ANSWER: usize = 60_000;
const MAX_LINE: u64 = 1_048_577;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChatRequest {
    pub run_id: String,
    pub chat_id: String,
    pub user_id: String,
    pub device_id: String,
    pub provider: String,
    pub input: String,
}
#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSnapshot {
    pub run_id: String,
    pub chat_id: String,
    pub user_id: String,
    pub device_id: String,
    pub sequence: u64,
    pub status: String,
    pub answer: String,
    pub usage: Option<Usage>,
    pub error: Option<String>,
    pub input_request: Option<InputRequest>,
}
struct PendingInput {
    rpc_id: Value,
    request: InputRequest,
}
struct Run {
    request: ChatRequest,
    child: Mutex<Child>,
    snapshot: Mutex<RunSnapshot>,
    cancelled: AtomicBool,
    stdin: Mutex<Option<ChildStdin>>,
    pending_input: Mutex<Option<PendingInput>>,
    clarifications: Mutex<String>,
    generating: AtomicBool,
}
#[derive(Clone, Default)]
pub struct ChatRuntime {
    runs: Arc<Mutex<BTreeMap<String, Arc<Run>>>>,
    closed: Arc<AtomicBool>,
    epoch: Arc<std::sync::atomic::AtomicU64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    provider: String,
    state: String,
    version: Option<String>,
    message: String,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_:-".contains(&b))
}
fn main_only(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Open the main DoggyNote window to use local agents.".into());
    }
    Ok(())
}
/// Trusted local environment only. No command, path, flags or cwd arrive from a card.
fn executable(provider: &str) -> Option<PathBuf> {
    let variable = match provider {
        "claude" => "DOGGYNOTE_CLAUDE_BIN",
        "codex" => "DOGGYNOTE_CODEX_BIN",
        _ => return None,
    };
    if let Some(path) = std::env::var_os(variable) {
        let path = PathBuf::from(path);
        return (path.is_absolute() && path.is_file()).then_some(path);
    }
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let mut candidates = vec![
        PathBuf::from("/opt/homebrew/bin").join(provider),
        PathBuf::from("/usr/local/bin").join(provider),
    ];
    if let Some(home) = home {
        candidates.insert(0, home.join(".local/bin").join(provider));
    }
    candidates.into_iter().find(|path| path.is_file())
}
fn command(path: &PathBuf) -> Command {
    let mut command = Command::new(path);
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command
}
fn terminate(child: &mut Child) {
    // A retained terminal run must never signal a recycled process-group ID.
    if matches!(child.try_wait(), Ok(Some(_))) {
        return;
    }
    #[cfg(unix)]
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    let _ = child.kill();
}
fn checked_output(path: &PathBuf, args: &[&str]) -> Result<(bool, String), String> {
    // Metadata must stay bounded even if a descendant retains the output pipe.
    #[cfg(not(unix))]
    {
        let _ = (path, args);
        return Err("Local providers require a Unix process runtime".into());
    }
    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd;
        let mut child = command(path)
            .args(args)
            .stdin(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|_| "Provider could not be started".to_string())?;
        let mut stdout = child.stdout.take().ok_or("Provider output unavailable")?;
        let mut stderr = child.stderr.take().ok_or("Provider output unavailable")?;
        let nonblocking = |fd| unsafe {
            let flags = libc::fcntl(fd, libc::F_GETFL);
            flags >= 0 && libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) >= 0
        };
        if !nonblocking(stdout.as_raw_fd()) || !nonblocking(stderr.as_raw_fd()) {
            terminate(&mut child);
            let _ = child.wait();
            return Err("Provider output unavailable".into());
        }
        let read_available = |pipe: &mut dyn Read, output: &mut Vec<u8>| -> Result<(), String> {
            let mut bytes = [0u8; 4096];
            loop {
                match pipe.read(&mut bytes) {
                    Ok(0) => return Ok(()),
                    Ok(count) => {
                        if output.len() + count > 64_000 {
                            return Err("Provider metadata is too large".into());
                        }
                        output.extend_from_slice(&bytes[..count]);
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => return Ok(()),
                    Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
                    Err(_) => return Err("Provider output unavailable".into()),
                }
            }
        };
        let started = Instant::now();
        let mut output = Vec::new();
        let mut diagnostics = Vec::new();
        loop {
            let read = read_available(&mut stdout, &mut output)
                .and_then(|_| read_available(&mut stderr, &mut diagnostics));
            if let Err(error) = read {
                terminate(&mut child);
                let _ = child.wait();
                return Err(error);
            }
            if let Some(exit) = child.try_wait().map_err(|_| "Provider unavailable")? {
                read_available(&mut stdout, &mut output)?;
                read_available(&mut stderr, &mut diagnostics)?;
                // Codex login status uses stderr. Raw diagnostics never leave Rust.
                let selected = if output.is_empty() {
                    diagnostics
                } else {
                    output
                };
                return Ok((
                    exit.success(),
                    String::from_utf8_lossy(&selected).into_owned(),
                ));
            }
            if started.elapsed() > Duration::from_secs(8) {
                terminate(&mut child);
                let _ = child.wait();
                return Err("Provider did not answer. Retry, or check it in Terminal.".into());
            }
            std::thread::sleep(Duration::from_millis(30));
        }
    }
}

fn discover(provider: &str) -> ProviderStatus {
    let status = |state: &str, version: Option<String>, message: &str| ProviderStatus {
        provider: provider.into(),
        state: state.into(),
        version,
        message: message.into(),
    };
    let Some(path) = executable(provider) else {
        return status(
            "missing",
            None,
            "Install the provider CLI, or set its DOGGYNOTE_*_BIN absolute path before launching DoggyNote.",
        );
    };
    let Ok((true, version)) = checked_output(&path, &["--version"]) else {
        return status(
            "unavailable",
            None,
            "The CLI could not start. Check it in Terminal, then retry.",
        );
    };
    let version = version.trim().chars().take(100).collect::<String>();
    if provider == "codex" {
        if version != codex::VERSION {
            return status(
                "unsupported",
                Some(version),
                "Use Codex CLI 0.163.0 for this adapter, then retry.",
            );
        }
        return match checked_output(&path, &["login", "status"]) {
            Ok((true, text))
                if text.contains("Logged in using ChatGPT")
                    || text.contains("Logged in using an API key") =>
            {
                status(
                    "ready",
                    Some(version),
                    "Ready on this Mac. Uses your configured CLI account and provider limits.",
                )
            }
            Ok(_) => status(
                "signed-out",
                Some(version),
                "Run codex login in Terminal, then retry. DoggyNote does not handle provider credentials.",
            ),
            Err(_) => status(
                "unavailable",
                Some(version),
                "Authentication could not be checked. Run codex login status in Terminal, then retry.",
            ),
        };
    }
    // Explicit compatibility window, not a permissive version guess. Restricted mode requires 2.1.248+.
    let patch = version
        .split_whitespace()
        .next()
        .and_then(|v| v.strip_prefix("2.1."))
        .and_then(|v| v.parse::<u32>().ok());
    if !patch.is_some_and(|n| (248..=399).contains(&n)) {
        return status(
            "unsupported",
            Some(version),
            "Use Claude Code 2.1.248–2.1.399 for this adapter, then retry.",
        );
    }
    match checked_output(&path, &["auth", "status"]) {
        Ok((true, text))
            if serde_json::from_str::<Value>(&text)
                .ok()
                .and_then(|v| v["loggedIn"].as_bool())
                == Some(true) =>
        {
            status(
                "ready",
                Some(version),
                "Ready on this Mac. Uses your configured CLI account and provider limits.",
            )
        }
        Ok(_) => status(
            "signed-out",
            Some(version),
            "Run claude auth login in Terminal, then retry. DoggyNote does not handle provider credentials.",
        ),
        Err(_) => status(
            "unavailable",
            Some(version),
            "Authentication could not be checked. Run claude auth status in Terminal, then retry.",
        ),
    }
}
#[tauri::command]
pub async fn chat_providers(window: tauri::WebviewWindow) -> Result<Vec<ProviderStatus>, String> {
    main_only(&window)?;
    tauri::async_runtime::spawn_blocking(|| vec![discover("claude"), discover("codex")])
        .await
        .map_err(|_| "Provider discovery failed".into())
}

#[derive(Debug, PartialEq)]
enum Parsed {
    Delta(String),
    Answer(String),
    Usage(u64, u64),
    Input(Value, Vec<codex::Question>),
    Completed,
    Failed(&'static str),
    Ignore,
}
fn classify_error(text: &str) -> &'static str {
    let text = text.to_ascii_lowercase();
    if text.contains("rate_limit")
        || text.contains("rate limit")
        || text.contains("usage limit")
        || text.contains("usage_limit")
        || text.contains("429")
    {
        "rate-limit"
    } else if text.contains("authentication")
        || text.contains("not logged in")
        || text.contains("invalid api key")
        || text.contains("oauth")
        || text.contains("unauthorized")
        || text.contains("401")
    {
        "signed-out"
    } else {
        "process-failed"
    }
}
/// Never forward raw harness diagnostics, reasoning or tool arguments to the shared board.
fn parse_claude(value: &Value) -> Vec<Parsed> {
    match value["type"].as_str() {
        Some("stream_event") => {
            let event = &value["event"];
            if event["type"] == "content_block_start"
                && event["content_block"]["type"] == "tool_use"
            {
                return vec![Parsed::Failed("tool-request")];
            }
            if event["type"] == "content_block_delta" && event["delta"]["type"] == "text_delta" {
                return event["delta"]["text"]
                    .as_str()
                    .map(|s| vec![Parsed::Delta(s.into())])
                    .unwrap_or(vec![Parsed::Failed("invalid-event")]);
            }
            vec![Parsed::Ignore]
        }
        Some("assistant") => {
            let Some(content) = value["message"]["content"].as_array() else {
                return vec![Parsed::Failed("invalid-event")];
            };
            if content.iter().any(|part| part["type"] == "tool_use") {
                return vec![Parsed::Failed("tool-request")];
            }
            let text = content
                .iter()
                .filter(|part| part["type"] == "text")
                .filter_map(|part| part["text"].as_str())
                .collect::<Vec<_>>()
                .join("");
            vec![Parsed::Answer(text)]
        }
        Some("result") => {
            if value["is_error"].as_bool() != Some(false) || value["subtype"] != "success" {
                return vec![Parsed::Failed(classify_error(&value.to_string()))];
            }
            let Some(answer) = value["result"].as_str() else {
                return vec![Parsed::Failed("invalid-event")];
            };
            vec![
                Parsed::Answer(answer.into()),
                Parsed::Usage(
                    value["usage"]["input_tokens"].as_u64().unwrap_or(0)
                        + value["usage"]["cache_read_input_tokens"]
                            .as_u64()
                            .unwrap_or(0)
                        + value["usage"]["cache_creation_input_tokens"]
                            .as_u64()
                            .unwrap_or(0),
                    value["usage"]["output_tokens"].as_u64().unwrap_or(0),
                ),
                Parsed::Completed,
            ]
        }
        Some("control_request") => vec![Parsed::Failed("tool-request")],
        Some("system") | Some("rate_limit_event") | Some("user") => vec![Parsed::Ignore],
        _ => vec![Parsed::Ignore],
    }
}
fn emit(app: &tauri::AppHandle, run: &Run) {
    if let Ok(snapshot) = run.snapshot.lock() {
        let _ = app.emit_to("main", "doggynote-chat", snapshot.clone());
    }
}
fn finish(app: &tauri::AppHandle, run: &Run, status: &str, error: Option<&str>) {
    if seal(run, status, error) {
        emit(app, run);
    }
}
fn seal(run: &Run, status: &str, error: Option<&str>) -> bool {
    if let Ok(mut snapshot) = run.snapshot.lock() {
        if snapshot.status != "running" {
            return false;
        }
        snapshot.status = status.into();
        snapshot.error = error.map(String::from);
        snapshot.sequence += 1;
        snapshot.input_request = None;
    }
    if let Ok(mut pending) = run.pending_input.lock() {
        pending.take();
    }
    if let Ok(mut stdin) = run.stdin.lock() {
        stdin.take();
    }
    true
}
fn write_rpc(run: &Run, value: &Value) -> Result<(), String> {
    let mut stdin = run
        .stdin
        .lock()
        .map_err(|_| "Local provider input unavailable")?;
    let stdin = stdin.as_mut().ok_or("This local run has ended")?;
    serde_json::to_writer(&mut *stdin, value)
        .map_err(|_| "The provider stopped accepting input")?;
    stdin
        .write_all(b"\n")
        .map_err(|_| "The provider stopped accepting input")?;
    stdin
        .flush()
        .map_err(|_| "The provider stopped accepting input".into())
}
fn respond_input(
    run: &Run,
    request_id: &str,
    answers: &BTreeMap<String, String>,
) -> Result<RunSnapshot, String> {
    let mut snapshot = run
        .snapshot
        .lock()
        .map_err(|_| "Local provider unavailable")?;
    if snapshot.status != "running" {
        return Err("This local run has ended".into());
    }
    let mut pending = run
        .pending_input
        .lock()
        .map_err(|_| "Local provider unavailable")?;
    let input = pending
        .as_ref()
        .filter(|input| input.request.id == request_id)
        .ok_or("This question has already been answered or ended")?;
    let (response, transcript) = codex::answer(&input.rpc_id, &input.request.questions, answers)?;
    let mut prefix = run
        .clarifications
        .lock()
        .map_err(|_| "Local provider unavailable")?;
    if snapshot.answer.encode_utf16().count() + transcript.encode_utf16().count() + 2 > MAX_ANSWER {
        return Err("This answer is too long. Shorten it or Stop and send a new message.".into());
    }
    write_rpc(run, &response)?;
    prefix.push_str(&transcript);
    prefix.push_str("\n\n");
    snapshot.answer.push_str(&transcript);
    snapshot.answer.push_str("\n\n");
    snapshot.input_request = None;
    snapshot.sequence += 1;
    pending.take();
    Ok(snapshot.clone())
}
#[tauri::command]
pub async fn chat_answer(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    runtime: tauri::State<'_, ChatRuntime>,
    run_id: String,
    user_id: String,
    device_id: String,
    request_id: String,
    answers: BTreeMap<String, String>,
) -> Result<RunSnapshot, String> {
    main_only(&window)?;
    let run = runtime
        .runs
        .lock()
        .map_err(|_| "Local provider unavailable")?
        .get(&run_id)
        .cloned()
        .ok_or("This local run has ended")?;
    if run.request.user_id != user_id || run.request.device_id != device_id {
        return Err("This run belongs to another device".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let snapshot = respond_input(&run, &request_id, &answers)?;
        emit(&app, &run);
        Ok(snapshot)
    })
    .await
    .map_err(|_| "The answer could not be sent".to_string())?
}
impl ChatRuntime {
    pub fn begin_session(&self) {
        self.closed.store(false, Ordering::SeqCst);
    }
    fn check_epoch(&self, epoch: u64) -> Result<(), String> {
        if self.closed.load(Ordering::SeqCst) || self.epoch.load(Ordering::SeqCst) != epoch {
            Err("The local session changed. Send again after signing in.".into())
        } else {
            Ok(())
        }
    }
    pub fn shutdown(&self) {
        self.closed.store(true, Ordering::SeqCst);
        self.epoch.fetch_add(1, Ordering::SeqCst);
        if let Ok(runs) = self.runs.lock() {
            for run in runs.values() {
                run.cancelled.store(true, Ordering::SeqCst);
                if let Ok(mut child) = run.child.lock() {
                    terminate(&mut child);
                }
                seal(run, "interrupted", Some("interrupted"));
            }
        }
    }
}
#[tauri::command]
pub fn chat_begin_session(
    window: tauri::WebviewWindow,
    runtime: tauri::State<'_, ChatRuntime>,
) -> Result<(), String> {
    main_only(&window)?;
    runtime.begin_session();
    Ok(())
}
#[tauri::command]
pub fn chat_stop_all(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    runtime: tauri::State<'_, ChatRuntime>,
) -> Result<(), String> {
    main_only(&window)?;
    runtime.shutdown();
    if let Ok(runs) = runtime.runs.lock() {
        for run in runs.values() {
            emit(&app, run);
        }
    }
    Ok(())
}
#[tauri::command]
pub fn chat_run_snapshot(
    window: tauri::WebviewWindow,
    runtime: tauri::State<'_, ChatRuntime>,
    run_id: String,
    user_id: String,
    device_id: String,
) -> Result<Option<RunSnapshot>, String> {
    main_only(&window)?;
    let runs = runtime.runs.lock().map_err(|_| "Local agent unavailable")?;
    runs.get(&run_id)
        .map(|r| {
            if r.request.user_id != user_id || r.request.device_id != device_id {
                return Err("This run belongs to another device".into());
            }
            r.snapshot
                .lock()
                .map(|s| s.clone())
                .map_err(|_| "Local agent unavailable".to_string())
        })
        .transpose()
}
#[tauri::command]
pub fn chat_stop(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    runtime: tauri::State<'_, ChatRuntime>,
    run_id: String,
    user_id: String,
    device_id: String,
) -> Result<(), String> {
    main_only(&window)?;
    let runs = runtime.runs.lock().map_err(|_| "Local agent unavailable")?;
    let run = runs.get(&run_id).ok_or("This local run has ended")?;
    if run.request.user_id != user_id || run.request.device_id != device_id {
        return Err("This run belongs to another device".into());
    }
    if run.snapshot.lock().is_ok_and(|s| s.status != "running") {
        return Ok(());
    }
    run.cancelled.store(true, Ordering::SeqCst);
    if let Ok(mut child) = run.child.lock() {
        terminate(&mut child);
    }
    finish(&app, run, "interrupted", Some("interrupted"));
    Ok(())
}
#[tauri::command]
pub async fn chat_start(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    runtime: tauri::State<'_, ChatRuntime>,
    request: ChatRequest,
) -> Result<RunSnapshot, String> {
    main_only(&window)?;
    if ![
        &request.run_id,
        &request.chat_id,
        &request.user_id,
        &request.device_id,
    ]
    .iter()
    .all(|id| valid_id(id))
        || request.input.is_empty()
        || request.input.len() > MAX_INPUT
    {
        return Err("Invalid or oversized local request".into());
    }
    if !["claude", "codex"].contains(&request.provider.as_str()) {
        return Err("This local provider adapter is not ready".into());
    }
    let runtime = runtime.inner().clone();
    let epoch = runtime.epoch.load(Ordering::SeqCst);
    runtime.check_epoch(epoch)?;
    tauri::async_runtime::spawn_blocking(move || start(app, runtime, request, epoch))
        .await
        .map_err(|_| "Local agent could not start".to_string())?
}
fn start(
    app: tauri::AppHandle,
    runtime: ChatRuntime,
    request: ChatRequest,
    epoch: u64,
) -> Result<RunSnapshot, String> {
    {
        let runs = runtime.runs.lock().map_err(|_| "Local agent unavailable")?;
        if let Some(prior) = runs.get(&request.run_id) {
            if prior.request != request {
                return Err("Run ID already used".into());
            }
            return prior
                .snapshot
                .lock()
                .map(|s| s.clone())
                .map_err(|_| "Local agent unavailable".into());
        }
    }
    if discover(&request.provider).state != "ready" {
        return Err(
            "Provider unavailable. Refresh providers and check its sign-in in Terminal.".into(),
        );
    }
    let mut runs = runtime.runs.lock().map_err(|_| "Local agent unavailable")?;
    runtime.check_epoch(epoch)?;
    if let Some(prior) = runs.get(&request.run_id) {
        if prior.request != request {
            return Err("Run ID already used".into());
        }
        return prior
            .snapshot
            .lock()
            .map(|s| s.clone())
            .map_err(|_| "Local agent unavailable".into());
    }
    if runs.len() >= 1024
        || runs
            .values()
            .filter(|r| r.snapshot.lock().is_ok_and(|s| s.status == "running"))
            .count()
            >= 4
    {
        return Err("Too many local runs. Stop a run or restart DoggyNote.".into());
    }
    let path = executable(&request.provider).ok_or("Provider missing")?;
    let cwd = std::env::temp_dir().join(format!(
        "doggynote-chat-{}-{}",
        std::process::id(),
        request.run_id
    ));
    let mut builder = std::fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder
        .create(&cwd)
        .map_err(|_| "Could not create an isolated agent directory")?;
    let mut cmd = command(&path);
    cmd.current_dir(&cwd);
    if request.provider == "codex" {
        codex::configure(&mut cmd);
    } else {
        cmd.args(["--restricted", "--print", "--verbose", "--output-format", "stream-json", "--include-partial-messages", "--tools", "", "--strict-mcp-config", "--mcp-config", "{\"mcpServers\":{}}", "--disallowedTools", "mcp__*", "--disable-slash-commands", "--setting-sources", "", "--settings", "{\"disableAllHooks\":true}", "--no-session-persistence", "--permission-mode", "dontAsk", "--system-prompt", "You are a text-only brainstorming assistant. Use only the supplied conversation and sources. No tools are available."]);
    }
    // Prevent inheriting an outer agent's session identity. Authentication stays with the CLI.
    cmd.env_remove("CLAUDECODE")
        .env_remove("CLAUDE_CODE_ENTRYPOINT");
    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(_) => {
            let _ = std::fs::remove_dir(&cwd);
            return Err("Provider process could not start".into());
        }
    };
    let stdout = child.stdout.take().ok_or("Provider output unavailable")?;
    let stdin = child.stdin.take().ok_or("Provider input unavailable")?;
    let snapshot = RunSnapshot {
        run_id: request.run_id.clone(),
        chat_id: request.chat_id.clone(),
        user_id: request.user_id.clone(),
        device_id: request.device_id.clone(),
        sequence: 0,
        status: "running".into(),
        answer: String::new(),
        usage: None,
        error: None,
        input_request: None,
    };
    let run = Arc::new(Run {
        request: request.clone(),
        child: Mutex::new(child),
        snapshot: Mutex::new(snapshot.clone()),
        cancelled: AtomicBool::new(false),
        stdin: Mutex::new(Some(stdin)),
        pending_input: Mutex::new(None),
        clarifications: Mutex::new(String::new()),
        generating: AtomicBool::new(request.provider == "claude"),
    });
    runs.insert(request.run_id.clone(), run.clone());
    drop(runs);
    let timer_run = run.clone();
    let timer_app = app.clone();
    std::thread::spawn(move || {
        let start = Instant::now();
        while timer_run
            .snapshot
            .lock()
            .is_ok_and(|s| s.status == "running")
        {
            if start.elapsed() > Duration::from_secs(600)
                || (!timer_run.generating.load(Ordering::SeqCst)
                    && start.elapsed() > Duration::from_secs(30))
            {
                timer_run.cancelled.store(true, Ordering::SeqCst);
                if let Ok(mut child) = timer_run.child.lock() {
                    terminate(&mut child);
                }
                finish(&timer_app, &timer_run, "interrupted", Some("interrupted"));
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    });
    std::thread::spawn(move || drive_provider(run, stdout, cwd, |run| emit(&app, run)));
    Ok(snapshot)
}
/// Shared production IO loop; deterministic subprocess tests use this exact path.
fn drive_provider(run: Arc<Run>, stdout: ChildStdout, cwd: PathBuf, changed: impl Fn(&Run)) {
    let is_codex = run.request.provider == "codex";
    // macOS temp aliases (/var -> /private/var) must compare by their
    // canonical directory, as app-server reports its resolved cwd.
    let resolved_cwd = cwd.canonicalize().unwrap_or_else(|_| cwd.clone());
    let mut protocol = codex::Protocol::new(
        resolved_cwd.to_string_lossy().into_owned(),
        run.request.input.clone(),
    );
    let input_run = run.clone();
    let (input_sent, input_received) = std::sync::mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let result = if is_codex {
            write_rpc(&input_run, &codex::initialize())
        } else {
            input_run
                .stdin
                .lock()
                .map_err(|_| "Provider input unavailable".to_string())
                .and_then(|mut writer| {
                    let mut stdin = writer.take().ok_or("Provider input unavailable")?;
                    stdin
                        .write_all(input_run.request.input.as_bytes())
                        .map_err(|_| "Provider input unavailable".into())
                })
        };
        if result.is_err() {
            if let Ok(mut child) = input_run.child.lock() {
                terminate(&mut child);
            }
        }
        let _ = input_sent.send(result.is_ok());
    });
    let mut reader = BufReader::new(stdout);
    let mut completed = false;
    let mut failure = None;
    loop {
        let mut line = Vec::new();
        match (&mut reader).take(MAX_LINE).read_until(b'\n', &mut line) {
            Ok(0) => break,
            Ok(_) if line.len() as u64 >= MAX_LINE => {
                failure = Some("invalid-event");
                break;
            }
            Err(_) => {
                failure = Some("process-failed");
                break;
            }
            _ => {}
        }
        if run.cancelled.load(Ordering::SeqCst) {
            break;
        }
        let Ok(value) = serde_json::from_slice::<Value>(&line) else {
            failure = Some("invalid-event");
            break;
        };
        let (events, done) = if is_codex {
            let outcome = protocol.consume(&value);
            for value in outcome.writes {
                if write_rpc(&run, &value).is_err() {
                    failure = Some("process-failed");
                    break;
                }
            }
            if protocol.generating() {
                run.generating.store(true, Ordering::SeqCst);
            }
            (outcome.events, outcome.done)
        } else {
            (parse_claude(&value), false)
        };
        for event in events {
            let mut state = run.snapshot.lock().unwrap();
            if state.status != "running" {
                break;
            }
            match event {
                Parsed::Delta(text) => {
                    state.answer.push_str(&text);
                    state.sequence += 1;
                }
                Parsed::Answer(text) => {
                    state.answer = format!("{}{}", run.clarifications.lock().unwrap(), text);
                    state.sequence += 1;
                }
                Parsed::Usage(input, output) => {
                    state.usage = Some(Usage {
                        input_tokens: Some(input),
                        output_tokens: Some(output),
                    });
                    state.sequence += 1;
                }
                Parsed::Input(rpc_id, questions) => {
                    let mut pending = run.pending_input.lock().unwrap();
                    if pending.is_some() {
                        failure = Some("tool-request");
                    } else {
                        state.sequence += 1;
                        let request = InputRequest {
                            id: format!("{}:input-{}", run.request.run_id, state.sequence),
                            questions,
                        };
                        state.input_request = Some(request.clone());
                        *pending = Some(PendingInput { rpc_id, request });
                    }
                }
                Parsed::Completed => completed = true,
                Parsed::Failed(error) => {
                    failure = Some(error);
                }
                Parsed::Ignore => {}
            }
            if state.answer.encode_utf16().count() > MAX_ANSWER {
                let mut count = 0;
                state.answer = state
                    .answer
                    .chars()
                    .take_while(|ch| {
                        count += ch.len_utf16();
                        count <= MAX_ANSWER
                    })
                    .collect();
                failure = Some("input-too-large");
            }
            drop(state);
            if failure.is_some() {
                break;
            }
        }
        if failure.is_some() {
            break;
        }
        changed(&run);
        if done {
            break;
        }
    }
    if input_received.recv_timeout(Duration::from_secs(1)) != Ok(true) && failure.is_none() {
        failure = Some("process-failed");
    }
    if let Ok(mut stdin) = run.stdin.lock() {
        stdin.take();
    }
    let exit_started = Instant::now();
    let success = loop {
        let exit = if let Ok(mut child) = run.child.lock() {
            if failure.is_some()
                || run.cancelled.load(Ordering::SeqCst)
                || exit_started.elapsed() > Duration::from_secs(5)
            {
                terminate(&mut child);
            }
            child.try_wait()
        } else {
            break false;
        };
        match exit {
            Ok(Some(exit)) => break exit.success(),
            Err(_) => break false,
            Ok(None) => std::thread::sleep(Duration::from_millis(30)),
        }
    };
    if run.cancelled.load(Ordering::SeqCst) {
        seal(&run, "interrupted", Some("interrupted"));
    } else if let Some(error) = failure {
        seal(
            &run,
            if error == "interrupted" {
                "interrupted"
            } else {
                "failed"
            },
            Some(error),
        );
    } else if completed && success {
        seal(&run, "completed", None);
    } else {
        seal(&run, "failed", Some("process-failed"));
    }
    changed(&run);
    let _ = std::fs::remove_dir_all(cwd);
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn parses_stream_and_does_not_forward_tool_or_reasoning_content() {
        assert_eq!(
            parse_claude(
                &json!({"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}})
            ),
            vec![Parsed::Delta("Hello".into())]
        );
        assert_eq!(
            parse_claude(
                &json!({"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"private"}}})
            ),
            vec![Parsed::Ignore]
        );
        assert_eq!(
            parse_claude(
                &json!({"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"path":"secret"}}]}})
            ),
            vec![Parsed::Failed("tool-request")]
        );
        assert_eq!(
            parse_claude(
                &json!({"type":"result","subtype":"success","is_error":false,"result":"Done","usage":{"input_tokens":4,"output_tokens":2}})
            ),
            vec![
                Parsed::Answer("Done".into()),
                Parsed::Usage(4, 2),
                Parsed::Completed
            ]
        );
        assert_eq!(
            parse_claude(
                &json!({"type":"result","subtype":"error","is_error":true,"errors":["rate limit"]})
            ),
            vec![Parsed::Failed("rate-limit")]
        );
    }
    #[test]
    fn validates_operation_identity_and_kills_actual_work() {
        assert!(valid_id("chat-1"));
        assert!(!valid_id("../../secret"));
        assert!(!valid_id("bad;cmd"));
        let mut child = command(&PathBuf::from("/bin/sleep"))
            .arg("30")
            .spawn()
            .unwrap();
        terminate(&mut child);
        assert!(!child.wait().unwrap().success());
    }
    #[test]
    fn metadata_reads_stderr_and_does_not_wait_for_inherited_pipes() {
        let python = PathBuf::from("/usr/bin/python3");
        let status = checked_output(
            &python,
            &[
                "-c",
                "import sys; sys.stderr.write('Logged in using ChatGPT')",
            ],
        )
        .unwrap();
        assert!(status.0 && status.1.contains("Logged in using ChatGPT"));
        assert!(checked_output(&python, &["-c", "print('x' * 64001)"]).is_err());
        let started = Instant::now();
        let child = checked_output(
            &python,
            &[
                "-c",
                "import subprocess; print(subprocess.Popen(['/bin/sleep','5']).pid)",
            ],
        )
        .unwrap();
        assert!(started.elapsed() < Duration::from_secs(2));
        let descendant = child.1.trim().parse::<i32>().unwrap();
        assert!(descendant > 0);
        #[cfg(unix)]
        unsafe {
            libc::kill(descendant, libc::SIGKILL);
        }
    }
    fn fixture(scenario: &str) -> (Arc<Run>, ChildStdout, PathBuf) {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let id = NEXT.fetch_add(1, Ordering::SeqCst);
        let cwd = std::env::temp_dir().join(format!(
            "doggynote-codex-fixture-{}-{id}",
            std::process::id()
        ));
        std::fs::create_dir(&cwd).unwrap();
        let mut cmd = command(&PathBuf::from("/usr/bin/python3"));
        cmd.args([
            "-u",
            concat!(env!("CARGO_MANIFEST_DIR"), "/src/chat/fixtures/codex.py"),
            scenario,
        ]);
        codex::configure(&mut cmd);
        cmd.current_dir(&cwd);
        let child = cmd.spawn().unwrap();
        test_run(child, cwd)
    }
    fn test_run(mut child: Child, cwd: PathBuf) -> (Arc<Run>, ChildStdout, PathBuf) {
        let stdout = child.stdout.take().unwrap();
        let stdin = child.stdin.take();
        let request = ChatRequest {
            run_id: "fixture-run".into(),
            chat_id: "fixture-chat".into(),
            user_id: "fixture-user".into(),
            device_id: "fixture-device".into(),
            provider: "codex".into(),
            input: "Only linked context".into(),
        };
        let snapshot = RunSnapshot {
            run_id: request.run_id.clone(),
            chat_id: request.chat_id.clone(),
            user_id: request.user_id.clone(),
            device_id: request.device_id.clone(),
            sequence: 0,
            status: "running".into(),
            answer: String::new(),
            usage: None,
            error: None,
            input_request: None,
        };
        let run = Arc::new(Run {
            request,
            child: Mutex::new(child),
            snapshot: Mutex::new(snapshot),
            cancelled: AtomicBool::new(false),
            stdin: Mutex::new(stdin),
            pending_input: Mutex::new(None),
            clarifications: Mutex::new(String::new()),
            generating: AtomicBool::new(false),
        });
        (run, stdout, cwd)
    }
    #[test]
    fn production_io_loop_completes_and_ignores_reasoning_and_late_events() {
        let (run, stdout, cwd) = fixture("success");
        drive_provider(run.clone(), stdout, cwd, |_| {});
        let state = run.snapshot.lock().unwrap();
        assert_eq!(state.status, "completed");
        assert_eq!(state.answer, "A complete answer.");
    }
    #[test]
    fn claude_io_loop_requires_all_input_to_be_delivered_before_success() {
        for scenario in ["success", "closed-input"] {
            let cwd = std::env::temp_dir().join(format!(
                "doggynote-claude-fixture-{}-{scenario}",
                std::process::id()
            ));
            std::fs::create_dir(&cwd).unwrap();
            let mut cmd = command(&PathBuf::from("/usr/bin/python3"));
            cmd.args([
                "-u",
                concat!(env!("CARGO_MANIFEST_DIR"), "/src/chat/fixtures/claude.py"),
                scenario,
            ])
            .current_dir(&cwd);
            let (mut run, stdout, cwd) = test_run(cmd.spawn().unwrap(), cwd);
            let request = &mut Arc::get_mut(&mut run).unwrap().request;
            request.provider = "claude".into();
            if scenario == "closed-input" {
                request.input = "x".repeat(500_000);
            }
            drive_provider(run.clone(), stdout, cwd, |_| {});
            let state = run.snapshot.lock().unwrap();
            assert_eq!(
                state.status,
                if scenario == "success" {
                    "completed"
                } else {
                    "failed"
                }
            );
            if scenario == "success" {
                assert_eq!(state.answer, "A complete answer.");
                assert_eq!(state.usage.as_ref().unwrap().input_tokens, Some(3));
            }
        }
    }
    #[test]
    fn production_io_loop_fails_closed_and_preserves_partial_answers() {
        for (scenario, error, answer) in [
            ("wide", "provider-unavailable", ""),
            ("malformed", "invalid-event", "A partial answer."),
            ("rate", "rate-limit", "A partial answer."),
        ] {
            let (run, stdout, cwd) = fixture(scenario);
            drive_provider(run.clone(), stdout, cwd, |_| {});
            let state = run.snapshot.lock().unwrap();
            assert_eq!(state.status, "failed", "{scenario}");
            assert_eq!(state.error.as_deref(), Some(error));
            assert_eq!(state.answer, answer);
        }
    }
    #[test]
    fn actual_pending_question_has_one_response_and_survives_final_answer_replacement() {
        let (run, stdout, cwd) = fixture("question");
        let answered = std::sync::atomic::AtomicU64::new(0);
        drive_provider(run.clone(), stdout, cwd, |run| {
            let input = run.snapshot.lock().unwrap().input_request.clone();
            if let Some(input) = input {
                let answers = BTreeMap::from([("tone".into(), "Playful".into())]);
                assert!(respond_input(run, "another-request", &answers).is_err());
                assert!(
                    respond_input(
                        run,
                        &input.id,
                        &BTreeMap::from([("other-question".into(), "Wrong".into())])
                    )
                    .is_err()
                );
                respond_input(run, &input.id, &answers).unwrap();
                assert!(respond_input(run, &input.id, &answers).is_err());
                answered.fetch_add(1, Ordering::SeqCst);
            }
        });
        let state = run.snapshot.lock().unwrap();
        assert_eq!(answered.load(Ordering::SeqCst), 1);
        assert_eq!(state.status, "completed");
        assert!(state.answer.contains("Which tone?"));
        assert!(state.answer.contains("Playful"));
        assert!(state.answer.ends_with("A playful kickoff."));
        assert!(state.input_request.is_none());
        assert_eq!(state.usage.as_ref().unwrap().input_tokens, Some(12));
    }
    #[test]
    fn session_shutdown_kills_children_and_rejects_pre_logout_startups_after_login() {
        let (run, _, cwd) = fixture("hang");
        let runtime = ChatRuntime::default();
        let old_epoch = runtime.epoch.load(Ordering::SeqCst);
        runtime
            .runs
            .lock()
            .unwrap()
            .insert(run.request.run_id.clone(), run.clone());
        runtime.shutdown();
        assert!(!run.child.lock().unwrap().wait().unwrap().success());
        assert_eq!(run.snapshot.lock().unwrap().status, "interrupted");
        assert!(runtime.check_epoch(old_epoch).is_err());
        runtime.begin_session();
        assert!(runtime.check_epoch(old_epoch).is_err());
        assert!(
            runtime
                .check_epoch(runtime.epoch.load(Ordering::SeqCst))
                .is_ok()
        );
        std::fs::remove_dir_all(cwd).unwrap();
    }
    #[test]
    fn actual_child_waiting_for_input_can_be_stopped_without_answering() {
        let (run, stdout, cwd) = fixture("question");
        let started = Instant::now();
        let waiting = AtomicBool::new(false);
        drive_provider(run.clone(), stdout, cwd, |run| {
            if run.snapshot.lock().unwrap().input_request.is_some() {
                waiting.store(true, Ordering::SeqCst);
                run.cancelled.store(true, Ordering::SeqCst);
                terminate(&mut run.child.lock().unwrap());
                seal(run, "interrupted", Some("interrupted"));
            }
        });
        assert!(waiting.load(Ordering::SeqCst));
        let state = run.snapshot.lock().unwrap();
        assert_eq!(state.status, "interrupted");
        assert!(state.input_request.is_none());
        assert!(run.pending_input.lock().unwrap().is_none());
        assert!(started.elapsed() < Duration::from_secs(5));
    }
    #[test]
    fn actual_streaming_child_stops_and_cannot_be_revived() {
        let (run, stdout, cwd) = fixture("hang");
        let started = Instant::now();
        drive_provider(run.clone(), stdout, cwd, |run| {
            if run.snapshot.lock().unwrap().answer == "A partial answer." {
                run.cancelled.store(true, Ordering::SeqCst);
                terminate(&mut run.child.lock().unwrap());
                seal(run, "interrupted", Some("interrupted"));
            }
        });
        let state = run.snapshot.lock().unwrap();
        assert_eq!(state.status, "interrupted");
        assert_eq!(state.answer, "A partial answer.");
        assert!(started.elapsed() < Duration::from_secs(5));
        drop(state);
        assert!(!seal(&run, "completed", None));
    }
    #[test]
    #[ignore = "Run with the loopback fixture in docs/qa/agent-canvas/codex-isolation-probe.py --rust-adapter"]
    fn installed_codex_uses_production_adapter_with_only_synthetic_inference() {
        let binary = PathBuf::from(
            std::env::var_os("DOGGYNOTE_TEST_CODEX_BIN").expect("explicit test CLI path"),
        );
        let port = std::env::var("DOGGYNOTE_TEST_MODEL_PORT")
            .unwrap()
            .parse::<u16>()
            .unwrap();
        assert!(binary.is_absolute() && port > 0);
        for inherited_source in ["none", "global", "model"] {
            let root = std::env::temp_dir().join(format!(
                "doggynote-installed-codex-{}-{inherited_source}",
                std::process::id()
            ));
            std::fs::create_dir(&root).unwrap();
            let cwd = root.join("work");
            let config = root.join("config");
            let trap = root.join("MCP_WAS_STARTED");
            std::fs::create_dir(&cwd).unwrap();
            std::fs::create_dir(&config).unwrap();
            let hidden = root.join("hidden-instructions.md");
            std::fs::write(&hidden, "DOGGYNOTE_UNLINKED_CONFIG model instructions").unwrap();
            if inherited_source == "global" {
                std::fs::write(
                    config.join("AGENTS.md"),
                    "DOGGYNOTE_UNLINKED_CONFIG user instructions",
                )
                .unwrap();
            }
            let model_config = if inherited_source == "model" {
                format!(
                    "model_instructions_file={}\n",
                    serde_json::to_string(&hidden.to_string_lossy()).unwrap()
                )
            } else {
                String::new()
            };
            std::fs::write(config.join("config.toml"), format!(
                "developer_instructions=\"DOGGYNOTE_UNLINKED_CONFIG developer instructions\"\n{model_config}[mcp_servers.synthetic_trap]\ncommand=\"/usr/bin/touch\"\nargs=[{}]\n",
                serde_json::to_string(&trap.to_string_lossy()).unwrap()
            )).unwrap();
            let mut cmd = command(&binary);
            cmd.env_clear()
                .env("PATH", "/usr/bin:/bin")
                .env("HOME", &root)
                .env("CODEX_HOME", &config)
                .env("DOGGYNOTE_FAKE_KEY", "synthetic-not-a-credential")
                .current_dir(&cwd);
            codex::configure(&mut cmd);
            cmd.args([
                "-c",
                "model=\"gpt-5.4\"",
                "-c",
                "model_provider=\"doggynote_fixture\"",
            ]);
            cmd.args(["-c", &format!("model_providers.doggynote_fixture={{name=\"Fixture\",base_url=\"http://127.0.0.1:{port}/v1\",env_key=\"DOGGYNOTE_FAKE_KEY\",wire_api=\"responses\",requires_openai_auth=false,supports_websockets=false}}")]);
            let (run, stdout, cwd) = test_run(cmd.spawn().unwrap(), cwd);
            drive_provider(run.clone(), stdout, cwd, |_| {});
            let state = run.snapshot.lock().unwrap();
            if inherited_source == "global" {
                // Refuse external instruction sources before sending the turn.
                assert_eq!(state.status, "failed");
                assert_eq!(state.error.as_deref(), Some("provider-unavailable"));
                assert!(state.answer.is_empty());
            } else {
                assert_eq!(state.status, "completed", "{:?}", state.error);
                assert_eq!(state.answer, "Synthetic probe only.");
                assert_eq!(state.usage.as_ref().unwrap().input_tokens, Some(1));
            }
            assert!(!trap.exists(), "Inherited MCP command launched");
            drop(state);
            std::fs::remove_dir_all(root).unwrap();
        }
    }
}
