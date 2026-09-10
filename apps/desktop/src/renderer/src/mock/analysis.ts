/**
 * An analysis for the development bridge, about the mock "multiple" pull request: long enough to
 * scroll, with every kind of block the reader has to set, and diagrams of two families.
 */
export const ANALYSIS_MARKDOWN = `## Background

Select is the component library's pick-one control: a trigger that shows the chosen value, a popup
that lists the options, and a root that owns the state and hands it down through context. Everyone
who has used a native \`<select>\` knows the shape; what is particular here is how the value flows.

### How a selection travels today

The root keeps one value, of whatever type the option's \`value\` prop carries, and one label for
it. Picking an option calls \`setValue\` with that option's value, the popup closes, and the trigger
re-renders with the label the root remembered.

\`\`\`mermaid
flowchart LR
  Option["Option\\nvalue: 'oak'"] -- "select('oak')" --> Root["SelectRoot\\nvalue: 'oak'\\nlabel: 'Oak'"]
  Root -- "context" --> Trigger["Trigger\\nshows 'Oak'"]
  Root -- "onValueChange('oak')" --> App["Your code"]
\`\`\`

> **Value versus label.** The value is what the application stores; the label is what the user
> reads. The root keeps both because the popup, where labels live, is not mounted while it is
> closed.

### The part this change touches

Three files know that there is exactly one value: the root's state, the option's "am I selected"
check, and the trigger's rendering of the current label. The keyboard handling in the popup does
not care; it moves highlight, not selection.

## Intuition

The pull request lets a Select hold several values at once. The trick is to keep the single-value
shape wherever possible and to widen only the three places that hold the value itself.

Take a Select of trees with \`multiple\`. The user picks Oak, then Ash:

| Step | Value before | Action | Value after |
| ---- | ------------ | ------ | ----------- |
| 1 | \`[]\` | pick Oak | \`['oak']\` |
| 2 | \`['oak']\` | pick Ash | \`['oak', 'ash']\` |
| 3 | \`['oak', 'ash']\` | pick Oak again | \`['ash']\` |

Picking toggles rather than replaces, and the popup stays open, since closing it after every pick
would make choosing five things a chore.

\`\`\`mermaid
sequenceDiagram
  participant U as User
  participant O as Option (Ash)
  participant R as SelectRoot
  participant T as Trigger
  U->>O: click
  O->>R: toggle('ash')
  R->>R: value = ['oak', 'ash']
  R-->>T: labels = ['Oak', 'Ash']
  T-->>U: shows "Oak, Ash"
  Note over R: popup stays open when multiple
\`\`\`

## Walkthrough

### The root learns to hold a list

\`SelectRoot\` gains a \`multiple\` prop. When it is set, \`value\` and \`defaultValue\` are arrays, and
the internal \`setValue\` becomes a toggle:

\`\`\`ts
function toggle(current: unknown[], next: unknown): unknown[] {
  return current.includes(next)
    ? current.filter((item) => item !== next)
    : [...current, next];
}
\`\`\`

The label state becomes a list too, kept in the order of selection rather than the order of the
options, which is what the trigger renders.

### Options check membership

\`SelectItem\` used to compare its value with the root's by identity. It now asks the root whether
it is selected, and the root answers with \`includes\` for a list and identity otherwise. The
\`data-selected\` attribute and the \`aria-selected\` state follow from that one answer.

### The trigger renders several labels

\`SelectValue\` joins the labels with a separator, defaulting to a comma and a space, and takes a
render prop for anyone who wants chips instead of text.

### Keyboard and closing

The popup's \`onItemClick\` no longer closes the popup when \`multiple\` is set. Escape and clicking
outside still do. Typeahead and arrow keys are untouched.
`;
