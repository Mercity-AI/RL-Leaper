import '../styles/ui/credits.css';
import { PROJECT_CREDITS, soundCredits } from '../audio/credits.js';

// The in-game credits, as a self-contained view: every sound's author and
// licence (made from src/audio/sounds.json, the same records as CREDITS.md),
// then the code and art the game is built with. Required credits (CC BY,
// CC BY-NC) come first; public-domain (CC0) sounds are credited with thanks.
//
// Mounting (for the menus): new CreditsView(container, { onClose }) puts it in
// `container`; show() / hide() toggle it, dispose() removes it. With onClose,
// a BACK button and the Escape key call it.

// A link that opens in a new tab, or plain text without a web address.
function linkOrText(text, url) {
  if (!url || !/^https?:/.test(url)) return document.createTextNode(text);
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = text;
  return link;
}

// One element with a class and text.
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class CreditsView {
  // credits: the sound credit records (default: from the manifest); project:
  // the code and art entries; onClose: shows a BACK button that calls it.
  constructor(parent = document.body, { credits = soundCredits(), project = PROJECT_CREDITS, onClose = null } = {}) {
    // 1. The panel, its heading and (optionally) a way back.
    this.element = element('section', 'credits-view');
    this.element.setAttribute('aria-labelledby', 'creditsTitle');
    this.element.tabIndex = -1;
    const header = element('header', 'credits-header');
    const title = element('h2', 'credits-title', 'CREDITS');
    title.id = 'creditsTitle';
    header.append(title);
    if (onClose) {
      this.back = element('button', 'credits-back', 'BACK');
      this.back.type = 'button';
      this.back.addEventListener('click', () => onClose());
      header.append(this.back);
      this.element.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      });
    }
    this.element.append(header, element('p', 'credits-intro',
      'Leaper is a non-commercial, open-source game. It uses the work of these people and projects.'));
    // 2. Sounds: required credits first, then the public-domain ones.
    const required = credits.filter((credit) => credit.required);
    const courtesy = credits.filter((credit) => !credit.required);
    this.element.append(this.section('Sounds that require credit', required.map((credit) => this.soundEntry(credit))));
    this.element.append(this.section('Public-domain sounds (CC0), with thanks', courtesy.map((credit) => this.soundEntry(credit))));
    // 3. NonCommercial notes, then code and art.
    const notes = credits.filter((credit) => credit.nonCommercial).map((credit) => {
      const item = element('li', 'credits-note');
      item.textContent = `"${credit.title}" by ${credit.author} is ${credit.licence}: fine for this non-commercial game, not for paid or promotional use.`;
      return item;
    });
    if (notes.length) this.element.append(this.section('Licence notes', notes));
    this.element.append(this.section('Code and art', project.map((credit) => this.projectEntry(credit))));
    parent.append(this.element);
  }

  // A titled list.
  section(heading, items) {
    const section = element('section', 'credits-section');
    const list = element('ul', 'credits-list');
    list.append(...items);
    section.append(element('h3', 'credits-heading', heading), list);
    return section;
  }

  // "Title" by Author · licence · used for ...
  soundEntry(credit) {
    const item = element('li', 'credits-entry');
    item.dataset.source = credit.key;
    const line = element('div', 'credits-line');
    line.append(linkOrText(credit.title, credit.sourceUrl), document.createTextNode(` by ${credit.author}`));
    const meta = element('div', 'credits-meta');
    meta.append(linkOrText(credit.licence, credit.licenceUrl), document.createTextNode(` · ${credit.sounds.join(', ')}`));
    item.append(line, meta);
    // The exact attribution text the licence asks for (shown for required credits).
    if (credit.required) item.append(element('div', 'credits-attribution', credit.attribution));
    return item;
  }

  // A library or a piece of art.
  projectEntry(credit) {
    const item = element('li', 'credits-entry');
    const line = element('div', 'credits-line');
    line.append(linkOrText(credit.title, credit.sourceUrl), document.createTextNode(`: ${credit.author}`));
    const meta = [credit.licence, credit.note].filter(Boolean).join(' · ');
    item.append(line);
    if (meta) item.append(element('div', 'credits-meta', meta));
    return item;
  }

  show() {
    this.element.hidden = false;
    this.element.focus({ preventScroll: true });
  }

  hide() {
    this.element.hidden = true;
  }

  dispose() {
    this.element.remove();
  }
}
