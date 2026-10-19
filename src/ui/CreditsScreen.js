import { creditSections } from './credits.js';

// The CREDITS screen's page side: one section per heading, one line per credit.
// The list itself (from the sound manifest) is plain data in src/ui/credits.js.
export function buildCredits(body, sections = creditSections()) {
  const list = document.createElement('div');
  list.className = 'credits';
  for (const { heading, lines } of sections) {
    const section = document.createElement('section');
    section.className = 'credits-section';
    const title = document.createElement('h3');
    title.textContent = heading;
    const items = document.createElement('ul');
    for (const line of lines) items.append(Object.assign(document.createElement('li'), { textContent: line }));
    section.append(title, items);
    list.append(section);
  }
  body.append(list);
}
