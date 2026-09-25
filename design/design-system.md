A minimal study workspace: a dark navigation rail, a white reading canvas, one blue, nearly square corners and hairline borders. Type does the work. Nothing decorates the page, so a long regulatory chapter stays easy to read.

## Content fundamentals

- **Speak to the learner as "you"**, plainly, like a tutor sitting beside them. The assistant speaks as "I". Real copy: "Stuck on something in this chapter?", "Ask about a definition, how a rule applies, or for a worked example."
- **Sentence case everywhere**: buttons, headings, labels ("Start studying", "Check your understanding", "Sign out"). Uppercase only through the `eyebrow` and `eyebrow-sm` styles.
- **Short and literal.** Greetings are one line ("Welcome back, Hyeon"). Card descriptions are one sentence. Buttons say what happens next: "Start studying", "Next: Licensing and registration", "Try again".
- **Feedback is kind and exact**. Right: "Correct — nicely done." Wrong: "Not quite. The answer is B." followed by the explanation.
- **Meta lines are short facts**: "14 min", "40% read", "Read", "2 questions", "1/2 correct", "3 of 9 chapters read", "Question 1 of 2".
- **Use the exam's own terms** (SFC, HKMA, SFO, licensed corporation, registered institution) and number sections as the syllabus does ("1.2 Who regulates what").
- No emoji. No exclamation marks.

## Visual foundations

**Colour.** Three zones. The **rail** (`rail`) is dark: chapter list, logo, account, with `on-rail` titles and `on-rail-muted` meta. The **canvas** is `surface`, with `surface-sunken` for headers, the assistant panel and callouts. **Text** is `ink` for headings, `ink-body` for reading, `ink-secondary` for labels and leads, `ink-muted` for meta and table headers. `accent` blue is the only colour: the primary button, links, focus, progress and correct answers. Tinted states (`accent-soft`) take `accent-hover` or `ink` text, never `accent`. Errors use `danger` / `danger-soft`, always with a cross icon and a sentence.

**Type.** One family: Source Sans 3 (Google Fonts, 400/500/600/700), falling back to Segoe UI and Helvetica Neue. It is chosen for plain, open letterforms that stay readable at small sizes and in long passages. Default UI text is `body` (16px). Big greetings (`display`) are regular weight, not bold; chapter and section titles are 600 (`chapter-title`, `section-heading`). Reading text is `reading` at 17px/1.65 in a column no wider than `size-measure`. Uppercase labels (`eyebrow-sm`) are small, 500, lightly tracked, in `ink-muted`, like table headers. Use tabular numerals for figures. Switch to the `-mobile` styles on phones.

**Spacing and layout.** On desktop: the rail (`size-rail`) on the left, the reading column (`size-measure`, `space-64` top) in the middle, the assistant (`size-panel-right`) on the right. Headers are `size-header` tall with a `line-divider` hairline. Spacing is a 4px-based scale (`space-4` … `space-64`); lay out siblings with flex and gap. Group related items into one bordered card split by vertical `line-divider` rules, rather than many separate cards.

**Corners.** Nearly square. `radius-control` (3px) on buttons, inputs and options; `radius-sm` (4px) on tables, tiles, callouts and rail rows; `radius-card` (8px) on the quiz card and chat bubbles; `radius-panel` (12px) for at most one hero card per screen. Pills (`radius-pill`) only for tabs, the assistant toggle and search fields.

**Borders, not shadows.** Cards and tables separate with 1px `line-soft` borders; controls use `line`. `shadow-card` is a 1px hint on the quiz card only. No gradients.

**States.** Hover shifts a fill one step (`accent` → `accent-hover` → `accent-pressed`; white → `surface-sunken`; transparent → `surface-hover`) or turns a border `accent`. Selected tabs and toggles fill `accent-soft`. Focus: a solid 2px `accent` outline with a 2px offset on every button, link and input (`rail-accent` on the rail); text fields also take an `accent` border plus `shadow-focus`.

**Motion.** Barely there. 0.15s colour changes on hover, 0.25s fade-and-rise (4px) for new chat messages, 0.4s for progress bars. No bouncing, scaling or drifting. Honour `prefers-reduced-motion` by cutting all of it.

## Iconography

Inline stroke icons on a 24px grid: `fill: none`, `stroke: currentColor`, stroke width 1.6 (2 for check and cross), round caps and joins, drawn at 14–18px. The set ships as the `Icon` component: `arrow-right`, `arrow-up`, `check`, `close`, `chat`, `globe`, `book`, `sign-out`, `panel-close`, `panel-open`. Trailing `arrow-right` marks a step forward. Icon-only buttons always carry an `aria-label`. No emoji.

## Accessibility notes

Text pairs meet 4.5:1 as noted on each token, on the canvas and on the rail. `progress` meets 3:1 on its track (3.8:1), and `rail-accent` on the rail track (4.7:1). One value is deliberately light: `line` control borders (1.6:1). Compensate as the components do: every control has visible text or a label and a solid focus ring. Controls are `size-control` (40px) on desktop and `size-control-lg` (44px) on phones.
