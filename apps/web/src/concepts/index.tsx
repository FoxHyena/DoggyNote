/* @refresh reload */
import { render } from 'solid-js/web'
import { installThemeCss } from '../theme.ts'
import { GroupingPlayground } from './GroupingPlayground.tsx'
import './grouping.css'

installThemeCss()
render(() => <GroupingPlayground />, document.getElementById('root')!)
