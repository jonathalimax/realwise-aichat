# Accessibility

Target WCAG 2.2 Level AA.

## Requirements

Keyboard navigation, visible focus, semantic HTML, proper headings, labels/descriptions, error announcements, contrast, no color-only meaning, reduced motion, accessible dialogs/menus/tables, skip link, meaningful titles, touch targets, and screen-reader-compatible status updates.

## Manual critical flows

Sign in, tenant creation, channel connection, knowledge creation, assistant playground, plan selection, Checkout initiation, billing portal, team invitation, and human-handoff queue.

## Automated

Use axe with Playwright. Automated checks supplement manual keyboard and screen-reader review.

## Errors

Focus summary, link errors to fields, preserve input, announce async results, restore focus after dialogs, and never rely on a toast alone for critical failure.

Test 375, 768, 1024, 1280, and 1440 widths plus zoom and text scaling.
