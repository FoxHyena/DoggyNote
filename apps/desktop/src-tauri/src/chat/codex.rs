//! Version-pinned app-server protocol. No raw config, diagnostics or reasoning
//! leave this module. Each run starts an ephemeral thread from visible history.
use super::{Parsed, classify_error};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

pub(super) const VERSION: &str = "codex-cli 0.163.0";
pub(super) const INSTRUCTIONS: &str = "You are a text-only brainstorming assistant. Use only the supplied conversation and sources. Shell, file, web, app and MCP tools are unavailable. If clarification is essential, ask a short non-secret question. Never request credentials or permissions.";

pub(super) fn configure(command: &mut std::process::Command) {
    command.args(["--strict-config", "app-server", "--listen", "stdio://"]);
    for option in [
        "notify=[]",
        "project_doc_max_bytes=0",
        "web_search=\"disabled\"",
        "features.multi_agent_v2={enabled=true,disable_native_tools=true}",
        "features.skip_host_skill_discovery=true",
        "features.shell_tool=false",
        "features.multi_agent=false",
        "features.apps=false",
        "features.plugins=false",
        "features.hooks=false",
        "features.memories=false",
        "features.shell_snapshot=false",
        "features.view_image=false",
        "features.goals=false",
        "features.sleep_tool=false",
        "features.default_mode_request_user_input=false",
        "features.browser_use=false",
        "features.browser_use_external=false",
        "features.computer_use=false",
        "features.in_app_browser=false",
        "features.in_app_local_automation=false",
        "features.image_generation=false",
        "features.code_mode=false",
        "features.code_mode_host=false",
        "features.tool_suggest=false",
        "features.skill_search=false",
        "features.artifact=false",
        "features.workspace_dependencies=false",
        "features.request_permissions_tool=false",
        "features.remote_plugin=false",
        "features.remote_control=false",
    ] {
        command.args(["-c", option]);
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuestionOption {
    pub label: String,
    pub description: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Question {
    pub id: String,
    pub header: String,
    pub question: String,
    #[serde(default)]
    pub options: Option<Vec<QuestionOption>>,
    #[serde(default)]
    pub is_secret: bool,
}
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InputRequest {
    pub id: String,
    pub questions: Vec<Question>,
}

fn bounded(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.encode_utf16().count() <= max
}
fn opaque_id(value: &Value) -> Option<String> {
    value
        .as_str()
        .filter(|id| bounded(id, 200))
        .map(String::from)
}
fn rpc(method: &str, id: u8, params: Value) -> Value {
    json!({"id":id,"method":method,"params":params})
}
pub(super) fn initialize() -> Value {
    rpc(
        "initialize",
        1,
        json!({"clientInfo":{"name":"doggynote","title":"DoggyNote","version":env!("CARGO_PKG_VERSION")},"capabilities":{"experimentalApi":true}}),
    )
}
pub(super) fn answer(
    request_id: &Value,
    questions: &[Question],
    answers: &BTreeMap<String, String>,
) -> Result<(Value, String), &'static str> {
    if answers.len() != questions.len() {
        return Err("Answer each question before continuing.");
    }
    let mut payload = serde_json::Map::new();
    let mut transcript = String::new();
    for question in questions {
        let value = answers
            .get(&question.id)
            .filter(|value| bounded(value, 4000))
            .ok_or("Answer each question with at most 4,000 characters.")?;
        payload.insert(question.id.clone(), json!({"answers":[value]}));
        transcript.push_str(&format!(
            "\n\n**Codex asks:** {}\n\n**You:** {}",
            question.question, value
        ));
    }
    Ok((
        json!({"id":request_id,"result":{"answers":payload}}),
        transcript,
    ))
}

#[derive(Debug, Default)]
pub(super) struct Outcome {
    pub writes: Vec<Value>,
    pub events: Vec<Parsed>,
    pub done: bool,
}
impl Outcome {
    fn failed(error: &'static str) -> Self {
        Self {
            events: vec![Parsed::Failed(error)],
            done: true,
            ..Self::default()
        }
    }
    fn write(value: Value) -> Self {
        Self {
            writes: vec![value],
            ..Self::default()
        }
    }
    fn event(value: Parsed) -> Self {
        Self {
            events: vec![value],
            ..Self::default()
        }
    }
}
pub(super) struct Protocol {
    expected: u8,
    cwd: String,
    input: String,
    thread: Option<String>,
    turn: Option<String>,
    terminal: bool,
    completed_items: BTreeSet<String>,
    input_ids: BTreeSet<String>,
}
impl Protocol {
    pub fn new(cwd: String, input: String) -> Self {
        Self {
            expected: 1,
            cwd,
            input,
            thread: None,
            turn: None,
            terminal: false,
            completed_items: BTreeSet::new(),
            input_ids: BTreeSet::new(),
        }
    }
    pub fn generating(&self) -> bool {
        self.turn.is_some()
    }
    pub fn consume(&mut self, value: &Value) -> Outcome {
        if self.terminal {
            return Outcome::default();
        }
        let outcome = self.consume_active(value);
        if outcome.done {
            self.terminal = true;
        }
        outcome
    }
    fn consume_active(&mut self, value: &Value) -> Outcome {
        // Only this one explicitly scoped request can receive a user response.
        if value.get("method").is_some() && value.get("id").is_some() {
            if value["method"] != "item/tool/requestUserInput" {
                return Outcome::failed("tool-request");
            }
            let params = &value["params"];
            if !self.matches(params) {
                return Outcome::failed("invalid-event");
            }
            if !(value["id"].as_i64().is_some() || opaque_id(&value["id"]).is_some()) {
                return Outcome::failed("invalid-event");
            }
            let key = value["id"].to_string();
            if self.input_ids.len() >= 16 {
                return Outcome::failed("input-too-large");
            }
            if !self.input_ids.insert(key) {
                return Outcome::default();
            }
            let Ok(questions) =
                serde_json::from_value::<Vec<Question>>(params["questions"].clone())
            else {
                return Outcome::failed("invalid-event");
            };
            let mut ids = BTreeSet::new();
            if questions.is_empty()
                || questions.len() > 3
                || questions.iter().any(|q| {
                    q.is_secret
                        || !bounded(&q.id, 128)
                        || !ids.insert(&q.id)
                        || !bounded(&q.header, 80)
                        || !bounded(&q.question, 2000)
                        || q.options.as_ref().is_some_and(|options| {
                            options.len() > 5
                                || options.iter().any(|o| {
                                    !bounded(&o.label, 100)
                                        || o.description.encode_utf16().count() > 300
                                })
                        })
                })
            {
                return Outcome::failed("tool-request");
            }
            return Outcome::event(Parsed::Input(value["id"].clone(), questions));
        }
        if let Some(id) = value["id"].as_u64() {
            if id != u64::from(self.expected) {
                return Outcome::default();
            }
            if let Some(error) = value.get("error") {
                return Outcome::failed(classify_error(&error.to_string()));
            }
            let Some(result) = value.get("result").filter(|r| r.is_object()) else {
                return Outcome::failed("invalid-event");
            };
            return match self.expected {
                1 => {
                    self.expected = 2;
                    Outcome {
                        writes: vec![
                            json!({"method":"initialized"}),
                            rpc("config/read", 2, json!({"includeLayers":false})),
                        ],
                        ..Outcome::default()
                    }
                }
                2 => {
                    let Some(config) = result["config"].as_object() else {
                        return Outcome::failed("invalid-event");
                    };
                    let Some(features) = config.get("features").filter(|v| v.is_object()) else {
                        return Outcome::failed("invalid-event");
                    };
                    if features["multi_agent_v2"]["enabled"] != true
                        || features["multi_agent_v2"]["disable_native_tools"] != true
                        || features["skip_host_skill_discovery"] != true
                        || [
                            "shell_tool",
                            "shell_snapshot",
                            "remote_control",
                            "multi_agent",
                            "apps",
                            "plugins",
                            "hooks",
                            "memories",
                            "view_image",
                            "goals",
                            "browser_use",
                            "browser_use_external",
                            "computer_use",
                            "in_app_browser",
                            "in_app_local_automation",
                            "image_generation",
                            "code_mode",
                            "code_mode_host",
                            "tool_suggest",
                            "skill_search",
                            "artifact",
                            "workspace_dependencies",
                            "request_permissions_tool",
                            "remote_plugin",
                        ]
                        .iter()
                        .any(|name| features[*name] != false)
                    {
                        return Outcome::failed("provider-unavailable");
                    }
                    let mut disabled = serde_json::Map::new();
                    if let Some(servers) = config.get("mcp_servers").filter(|v| !v.is_null()) {
                        let Some(servers) = servers.as_object().filter(|s| s.len() <= 128) else {
                            return Outcome::failed("provider-unavailable");
                        };
                        for name in servers.keys() {
                            if !bounded(name, 200) {
                                return Outcome::failed("provider-unavailable");
                            }
                            disabled.insert(name.clone(), json!({"enabled":false}));
                        }
                    }
                    self.expected = 3;
                    Outcome::write(rpc(
                        "thread/start",
                        3,
                        json!({"cwd":self.cwd,"ephemeral":true,"approvalPolicy":"never","sandbox":"read-only","baseInstructions":INSTRUCTIONS,"developerInstructions":INSTRUCTIONS,"config":{"mcp_servers":disabled}}),
                    ))
                }
                3 => {
                    // Managed policies must not silently widen the requested boundary.
                    if result["approvalPolicy"] != "never"
                        || result["sandbox"]["type"] != "readOnly"
                        || result["cwd"] != self.cwd
                        || result["thread"]["ephemeral"] != true
                        || result["instructionSources"]
                            .as_array()
                            .is_none_or(|s| !s.is_empty())
                    {
                        return Outcome::failed("provider-unavailable");
                    }
                    let Some(thread) = opaque_id(&result["thread"]["id"]) else {
                        return Outcome::failed("invalid-event");
                    };
                    self.thread = Some(thread.clone());
                    self.expected = 5;
                    Outcome::write(rpc(
                        "mcpServerStatus/list",
                        5,
                        json!({"threadId":thread,"detail":"full","limit":100}),
                    ))
                }
                5 => {
                    let Some(servers) = result["data"].as_array() else {
                        return Outcome::failed("invalid-event");
                    };
                    if !result["nextCursor"].is_null()
                        || servers.iter().any(|s| {
                            s["runtimeStatus"] != "disabled"
                                || s["tools"].as_object().is_none_or(|v| !v.is_empty())
                                || s["resources"].as_array().is_none_or(|v| !v.is_empty())
                                || s["resourceTemplates"]
                                    .as_array()
                                    .is_none_or(|v| !v.is_empty())
                        })
                    {
                        return Outcome::failed("provider-unavailable");
                    }
                    self.expected = 4;
                    let input = std::mem::take(&mut self.input);
                    Outcome::write(rpc(
                        "turn/start",
                        4,
                        json!({"threadId":self.thread,"input":[{"type":"text","text":input}]}),
                    ))
                }
                4 => {
                    let Some(turn) = opaque_id(&result["turn"]["id"]) else {
                        return Outcome::failed("invalid-event");
                    };
                    if self.turn.as_ref().is_some_and(|id| id != &turn) {
                        return Outcome::failed("invalid-event");
                    }
                    self.turn = Some(turn);
                    self.expected = 0;
                    Outcome::default()
                }
                _ => Outcome::default(),
            };
        }
        let params = &value["params"];
        if value["method"] == "turn/started"
            && self.expected == 4
            && params["threadId"].as_str() == self.thread.as_deref()
        {
            let Some(turn) = opaque_id(&params["turn"]["id"]) else {
                return Outcome::failed("invalid-event");
            };
            self.turn = Some(turn);
            return Outcome::default();
        }
        if !self.matches(params) {
            return Outcome::default();
        }
        match value["method"].as_str() {
            Some("item/agentMessage/delta") => {
                let Some(item) = opaque_id(&params["itemId"]) else {
                    return Outcome::failed("invalid-event");
                };
                if self.completed_items.contains(&item) {
                    return Outcome::default();
                }
                params["delta"]
                    .as_str()
                    .map(|text| Outcome::event(Parsed::Delta(text.into())))
                    .unwrap_or_else(|| Outcome::failed("invalid-event"))
            }
            Some("item/started") | Some("item/completed") => {
                let item = &params["item"];
                match item["type"].as_str() {
                    Some("agentMessage") if value["method"] == "item/completed" => {
                        let Some(id) = opaque_id(&item["id"]) else {
                            return Outcome::failed("invalid-event");
                        };
                        if self.completed_items.len() >= 512 {
                            return Outcome::failed("input-too-large");
                        }
                        if !self.completed_items.insert(id) {
                            return Outcome::default();
                        }
                        item["text"]
                            .as_str()
                            .map(|text| Outcome::event(Parsed::Answer(text.into())))
                            .unwrap_or_else(|| Outcome::failed("invalid-event"))
                    }
                    Some("agentMessage" | "userMessage" | "reasoning" | "plan") => {
                        Outcome::default()
                    }
                    // Includes shell/file/MCP/dynamic/browser/image/collaboration tools.
                    _ => Outcome::failed("tool-request"),
                }
            }
            Some("thread/tokenUsage/updated") => {
                let usage = &params["tokenUsage"]["total"];
                match (
                    usage["inputTokens"].as_u64(),
                    usage["outputTokens"].as_u64(),
                ) {
                    (Some(input), Some(output)) => Outcome::event(Parsed::Usage(input, output)),
                    _ => Outcome::failed("invalid-event"),
                }
            }
            Some("turn/completed") => match params["turn"]["status"].as_str() {
                Some("completed") => Outcome {
                    events: vec![Parsed::Completed],
                    done: true,
                    ..Outcome::default()
                },
                Some("interrupted") => Outcome::failed("interrupted"),
                Some("failed") => {
                    Outcome::failed(classify_error(&params["turn"]["error"].to_string()))
                }
                _ => Outcome::failed("invalid-event"),
            },
            Some("error") if params["willRetry"] != true => {
                Outcome::failed(classify_error(&params["error"].to_string()))
            }
            _ => Outcome::default(),
        }
    }
    fn matches(&self, params: &Value) -> bool {
        if self.thread.is_none() || self.turn.is_none() {
            return false;
        }
        let turn = params["turnId"]
            .as_str()
            .or_else(|| params["turn"]["id"].as_str());
        params["threadId"].as_str() == self.thread.as_deref() && turn == self.turn.as_deref()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn ready() -> Protocol {
        let mut p = Protocol::new("/isolated".into(), "Only linked context".into());
        p.consume(&json!({"id":1,"result":{}}));
        let mut features = json!({"multi_agent_v2":{"enabled":true,"disable_native_tools":true},"skip_host_skill_discovery":true});
        for name in [
            "shell_tool",
            "shell_snapshot",
            "remote_control",
            "multi_agent",
            "apps",
            "plugins",
            "hooks",
            "memories",
            "view_image",
            "goals",
            "browser_use",
            "browser_use_external",
            "computer_use",
            "in_app_browser",
            "in_app_local_automation",
            "image_generation",
            "code_mode",
            "code_mode_host",
            "tool_suggest",
            "skill_search",
            "artifact",
            "workspace_dependencies",
            "request_permissions_tool",
            "remote_plugin",
        ] {
            features[name] = json!(false);
        }
        let start = p.consume(&json!({"id":2,"result":{"config":{"features":features,"mcp_servers":{"inherited":{"command":"must-not-launch"},"name.with.dots":{}}}}}));
        assert_eq!(
            start.writes[0]["params"]["config"]["mcp_servers"]["inherited"]["enabled"],
            false
        );
        assert_eq!(
            start.writes[0]["params"]["config"]["mcp_servers"]["name.with.dots"]["enabled"],
            false
        );
        let check = p.consume(&json!({"id":3,"result":{"approvalPolicy":"never","sandbox":{"type":"readOnly"},"cwd":"/isolated","instructionSources":[],"thread":{"id":"thread","ephemeral":true}}}));
        assert_eq!(check.writes[0]["method"], "mcpServerStatus/list");
        let turn = p.consume(&json!({"id":5,"result":{"data":[],"nextCursor":null}}));
        assert_eq!(
            turn.writes[0]["params"]["input"][0]["text"],
            "Only linked context"
        );
        p.consume(&json!({"id":4,"result":{"turn":{"id":"turn"}}}));
        p
    }
    #[test]
    fn handshake_precedes_inference_and_rejects_widened_inventory() {
        let mut p = ready();
        p.expected = 5;
        let outcome = p.consume(&json!({"id":5,"result":{"data":[{"runtimeStatus":"ready","tools":{},"resources":[],"resourceTemplates":[]}],"nextCursor":null}}));
        assert!(outcome.writes.is_empty());
        assert_eq!(outcome.events, vec![Parsed::Failed("provider-unavailable")]);
    }
    #[test]
    fn only_correlated_text_and_usage_are_forwarded_and_terminal_is_sealed() {
        let mut p = ready();
        assert!(p.consume(&json!({"method":"item/agentMessage/delta","params":{"threadId":"other","turnId":"turn","itemId":"m","delta":"secret"}})).events.is_empty());
        assert!(p.consume(&json!({"method":"item/reasoning/textDelta","params":{"threadId":"thread","turnId":"turn","delta":"secret"}})).events.is_empty());
        assert_eq!(p.consume(&json!({"method":"item/agentMessage/delta","params":{"threadId":"thread","turnId":"turn","itemId":"m","delta":"Hello"}})).events, vec![Parsed::Delta("Hello".into())]);
        let final_item = json!({"method":"item/completed","params":{"threadId":"thread","turnId":"turn","item":{"type":"agentMessage","id":"m","text":"Hello world"}}});
        assert_eq!(
            p.consume(&final_item).events,
            vec![Parsed::Answer("Hello world".into())]
        );
        assert!(p.consume(&final_item).events.is_empty());
        assert_eq!(p.consume(&json!({"method":"thread/tokenUsage/updated","params":{"threadId":"thread","turnId":"turn","tokenUsage":{"total":{"inputTokens":12,"outputTokens":4}}}})).events, vec![Parsed::Usage(12,4)]);
        assert!(p.consume(&json!({"method":"turn/completed","params":{"threadId":"thread","turn":{"id":"turn","status":"completed"}}})).done);
        assert!(p.consume(&final_item).events.is_empty());
    }
    #[test]
    fn rejects_tools_secret_questions_and_unscoped_or_oversize_answers() {
        let mut p = ready();
        assert_eq!(
            p.consume(
                &json!({"method":"item/commandExecution/requestApproval","id":99,"params":{}})
            )
            .events,
            vec![Parsed::Failed("tool-request")]
        );
        let mut p = ready();
        let request = json!({"method":"item/tool/requestUserInput","id":"q","params":{"threadId":"thread","turnId":"turn","questions":[{"id":"tone","header":"Tone","question":"Which tone?","isSecret":false}]}});
        let events = p.consume(&request).events;
        let Parsed::Input(id, questions) = &events[0] else {
            panic!("expected scoped input");
        };
        assert!(answer(id, questions, &BTreeMap::new()).is_err());
        assert!(
            answer(
                id,
                questions,
                &BTreeMap::from([("tone".into(), "x".repeat(4001))])
            )
            .is_err()
        );
        let (response, transcript) = answer(
            id,
            questions,
            &BTreeMap::from([("tone".into(), "Playful".into())]),
        )
        .unwrap();
        assert_eq!(
            response["result"]["answers"]["tone"]["answers"][0],
            "Playful"
        );
        assert!(transcript.contains("Which tone?"));
        assert!(transcript.contains("Playful"));
        assert!(p.consume(&request).events.is_empty());
        let mut p = ready();
        let mut secret = request;
        secret["params"]["questions"][0]["isSecret"] = json!(true);
        assert_eq!(
            p.consume(&secret).events,
            vec![Parsed::Failed("tool-request")]
        );
    }
}
