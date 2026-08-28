/* Generated for dsh-mcp-manager-ui — do not edit. */
import { z } from 'zod'

const $any = z.unknown()
const $name = z.string()

const mv = (method, params, resultSym) => ({
  id: `dsh-mcp-manager-ui#mcpManager/${method}`,
  service: 'mcpManager',
  namespace: 'mcpManager',
  method,
  invocation: { kind: 'direct' },
  parameters: params,
  result: { mode: 'strict', typeSymbol: `dsh-mcp-manager-ui/typert#${resultSym}`, schema: $any },
  sourceLocation: { file: 'dsh-mcp-manager-ui/lib/typert.js', line: 7, column: 1 },
})

const nameParam = { name: 'name', wire: 'name', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-mcp-manager-ui/typert#String', schema: $name } }
const specParam = { name: 'spec', wire: 'spec', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-mcp-manager-ui/typert#Spec', schema: $any } }
const payloadParam = { name: 'payload', wire: 'payload', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-mcp-manager-ui/typert#ImportPayload', schema: $any } }
const builtinInstallParam = { name: 'payload', wire: 'payload', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-mcp-manager-ui/typert#BuiltinInstallPayload', schema: $any } }

export const TYPERT = {
  package: 'dsh-mcp-manager-ui',
  face: 'host',
  schemas: [],
  invocations: [
    mv('list', [], 'ListResult'),
    mv('status', [nameParam], 'StatusResult'),
    mv('enable', [nameParam], 'NoteResult'),
    mv('disable', [nameParam], 'NoteResult'),
    mv('reconnect', [nameParam], 'NoteResult'),
    mv('tools', [nameParam], 'ToolsResult'),
    mv('builtins', [], 'BuiltinCatalogResult'),
    mv('installBuiltins', [builtinInstallParam], 'BuiltinInstallResult'),
    mv('add', [specParam], 'NoteResult'),
    mv('update', [specParam], 'NoteResult'),
    mv('removeServer', [nameParam], 'NoteResult'),
    mv('reveal', [payloadParam], 'RevealResult'),
    mv('previewImport', [payloadParam], 'ImportPreview'),
    mv('importJson', [payloadParam], 'ImportResult'),
    mv('listWorkspaces', [], 'WorkspaceListResult'),
    mv('getWorkspaceView', [payloadParam], 'WorkspaceViewResult'),
    mv('addWorkspaceServer', [payloadParam], 'NoteResult'),
    mv('updateWorkspaceServer', [payloadParam], 'NoteResult'),
    mv('removeWorkspaceServer', [payloadParam], 'NoteResult'),
    mv('setWorkspaceExclude', [payloadParam], 'NoteResult'),
    mv('installWorkspaceBuiltins', [builtinInstallParam], 'BuiltinInstallResult'),
    mv('previewWorkspaceImport', [payloadParam], 'ImportPreview'),
    mv('importWorkspaceJson', [payloadParam], 'ImportResult'),
    mv('revealWorkspaceServer', [payloadParam], 'RevealResult'),
  ],
  model: { services: [], events: [], objects: [] },
}