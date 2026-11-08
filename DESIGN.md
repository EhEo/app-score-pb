# COURTSIDE · 피클볼 점수판

## 0. Research Log
Embedded references: Nike / Apple / Linear considered; native CSS with taste-skill and Nike's strong numeric hierarchy selected for outdoor sports use. No copied brand assets. External concept-image research omitted: this is a functional scoreboard, not a marketing surface.

## 1. Atmosphere & Identity
An instrument beside the court. Ink-black ground, oversized tabular scores, lime for team A and sky blue for team B. A court-line motif and clear service strip are the signature. No decorative animation.

## 2. Color
CSS tokens: bg #101512, surface #19211c, elevated #222e26, text #f5f8ef, muted #b0bdb2, line #39483e, lime #d3fa76, blue #99d5ff, danger #ffb5a7. Light appearance retains the dark court display intentionally for distance readability.

## 3. Typography
System sans-serif with Korean fallbacks. Body 16px / 1.5; metadata 14px; section headings 24px; title clamp 32–56px; tabular scores clamp 80–220px, 800 weight. No downloaded fonts.

## 4. Spacing & Layout
4px unit; 8, 12, 16, 24, 32px gaps. Max content 1120px. Document owns scrolling. Dialog alone scrolls when open. Scoreboard two columns at all widths; setup becomes one column below 640px. Display view fills 100dvh where content permits, with controls outside the score region. Safe-area padding.

Mobile-first v3 overrides: app chrome 60px; active match fills available dynamic viewport with two equal score targets, a concise service card, and a bottom four-action dock. At 360×740 default content must fit without scrolling; very short/zoomed screens retain document scroll. Match metadata is one compact row; no marketing footer during a match. Team names wrap rather than truncate. Scores shrink for 3/4-digit values. Entry screen has one dominant start button and two secondary rows, with a small court illustration. Dialogs become bottom sheets <=640px with a separately scrolling body and stable title; forms use a two-column switcher for simple settings, full width for team inputs. Optional team names and service corrections live in native details panels. Main background remains ink, team A lime and B blue; no reliance on color alone. Thumb dock targets >=56px. Safe area at bottom and keyboard viewport accommodated through 100dvh and native document scroll.

## 5. Primitives & States
Button (primary, secondary, danger, disabled, focus-visible), labeled input/select, score panel (team A/B, serving, completed), status badge (local, connecting, connected, stale), native modal (setup, correction, pairing, history), game result row. Touch targets >=48px; main rally targets >=150px. Disabled winner controls after game end. Server state uses text plus color. Component states exercised in real setup/score/dialog screens.

Touch revision: entire score and action caption form one native button, >=200px high on phones and >=260px on tablets; the team heading remains a stable noninteractive label. Official receiving team's action states server/service change rather than promising +1. Numeric correction uses 56px minus/plus buttons around a 64px numeric input, preserving direct keyboard editing. Zero/9999 bounds disable the relevant button. Action grids have 8px gutters and 48px minimum targets. Phone toolbar is a three-column grid, score panels have no nested controls. Modal footer remains visible inside its scroll container. No hover-only interaction; press state has an inset outline. Tap feedback is available through optional device vibration. Tablets use up to 1320px content width; landscape with short height reduces header spacing. No controls are introduced on linked viewer score panels.

## 6. Motion

Standalone landscape revision: bound the body to 100dvh, hide document overflow, and use main rows auto/minmax(0,1fr)/auto. Two score panels span the wide middle row; service and four controls share the bottom row. Short landscape headers compress to 44px; numeric type follows viewport height. Optional game chips and repeated hints are omitted from the court surface; result panels overlay the middle region, keeping the control dock reachable. Only modal content may scroll. Fullscreen button requests landscape orientation when supported; rotation remains user-controlled in browsers without orientation locking.
Only button press feedback; no continuous movement or flashing. Respect reduced motion. Focus ring visible on keyboard navigation.

## 7. Responsive & Accessibility
Korean labels, semantic forms and dialogs, score announcements via polite live region, escaped user content, accessible icon labels. Large scores remain readable at tablet landscape and mobile portrait. Fullscreen and wake lock are optional progressive enhancements.

## 8. Constraints & Accepted Debt
Browser speech depends on installed Korean voice and needs a user gesture. Home-screen install/offline caching requires HTTPS (localhost exception). Public deployment and physical-device outdoor readability require user deployment/device checks. Browser data clearing removes local history. No login or remote history recovery.
