// The CC Rules panel's state: what `rules.js list --json` and `scan --json`
// print, and the problem to show when the rules couldn't be read.

export type RuleItem = { id: string; active: boolean; text: string };

export type RuleLevel = {
  level: 'global' | 'project' | 'chat';
  label: string;
  file: string;
  exists: boolean;
  rules: RuleItem[];
};

export type RulesView = {
  project: { kind: 'group' | 'folder'; name: string };
  chatTitle: string | null;
  levels: RuleLevel[];
  notices: string[];
  watch: string[];
};

// Where a hidden rule can go: `value` is what `adopt --to` takes, or "keep".
export type MoveTarget = { value: string; label: string };

// A rule found outside CC Rules, with the places it can be assigned to.
export type HiddenItem = {
  id: string;
  kind: 'line' | 'memory';
  label: string;
  line: number;
  section: string | null;
  text: string;
  targets: MoveTarget[];
};

// `assigned`: rules left out because CC Rules already has them.
// `ignored`: rules left out because the person kept them where they are.
export type ScanView = { items: HiddenItem[]; assigned: number; ignored: number };

declare module 'claude-code' {
  interface PluginState {
    'cc-rules': { view: RulesView | null; problem: string | null; hidden: ScanView | null };
  }
}
