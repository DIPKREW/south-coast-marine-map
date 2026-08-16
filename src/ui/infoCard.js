/**
 * A small, on-brand hover INFO CARD. Pure DOM (no MapLibre popup chrome) so it
 * stays calm and fully styleable. Follows the cursor inside the map container
 * and renders structured, per-layer content: title · subtitle · meta · note.
 */
export class InfoCard {
  constructor(container) {
    this.container = container;
    this.el = document.createElement('div');
    this.el.className = 'info-card';
    this.el.setAttribute('role', 'status');
    container.appendChild(this.el);

    this._title = child(this.el, 'div', 'info-card__title');
    this._subtitle = child(this.el, 'div', 'info-card__subtitle');
    this._meta = child(this.el, 'div', 'info-card__meta');
    this._note = child(this.el, 'div', 'info-card__note');
    this._link = child(this.el, 'a', 'info-card__link');
    this._link.target = '_blank';
    this._link.rel = 'noopener';
    this._link.style.display = 'none';

    this._visible = false;
    this._key = null;
    this._hasLink = false; // current card carries a clickable link
    this._pinned = false; // pointer is over the card (keep it alive)
    this._hideTimer = null;

    // When a card has a link it becomes interactive: hovering it cancels the
    // pending hide so the link is clickable; leaving it hides the card.
    this.el.addEventListener('mouseenter', () => {
      if (!this._hasLink) return;
      this._pinned = true;
      this._cancelHide();
    });
    this.el.addEventListener('mouseleave', () => {
      this._pinned = false;
      this.hide();
    });
  }

  _cancelHide() {
    if (this._hideTimer) {
      clearTimeout(this._hideTimer);
      this._hideTimer = null;
    }
  }

  /**
   * @param {{title, subtitle?, meta?, note?}} card
   * @param {{x:number,y:number}} point
   * @param {string} accent  CSS colour for the card's accent
   */
  show(card, point, accent) {
    this._cancelHide(); // a fresh feature cancels any pending grace-period hide
    // Only rebuild text when the content actually changes (avoids layout churn).
    const link = card.link || null;
    const key = `${card.title}|${card.subtitle}|${card.meta}|${card.note}|${link?.href || ''}`;
    if (key !== this._key) {
      this._key = key;
      setLine(this._title, card.title);
      setLine(this._subtitle, card.subtitle);
      setLine(this._meta, card.meta);
      setLine(this._note, card.note);
      setLink(this._link, link);
    }
    this._hasLink = !!link;
    // Interactive only when there's a link to click — otherwise the card stays
    // click-through, exactly as before, so every other layer is unaffected.
    this.el.classList.toggle('is-interactive', this._hasLink);
    if (accent) this.el.style.setProperty('--card-accent', accent);

    // Position: offset from the cursor, flipping/raising near the edges so the
    // card never spills out of the map.
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const cardW = this.el.offsetWidth || 220;
    const cardH = this.el.offsetHeight || 90;
    const off = 14;
    const flipX = point.x + off + cardW > w - 8;
    const flipY = point.y + off + cardH > h - 8;
    const x = flipX ? point.x - off - cardW : point.x + off;
    const y = flipY ? Math.max(8, point.y - off - cardH) : point.y + off;
    this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;

    if (!this._visible) {
      this._visible = true;
      this.el.classList.add('is-visible');
    }
  }

  hide() {
    this._cancelHide();
    if (!this._visible) return;
    this._visible = false;
    this._key = null;
    this.el.classList.remove('is-visible');
  }

  // A "soft" hide used when the cursor leaves the map: link cards get a short
  // grace period to let the pointer travel onto the card and click the link;
  // every other card hides immediately, preserving the prior behaviour.
  requestHide() {
    if (this._hasLink && this._visible && !this._pinned) {
      this._cancelHide();
      this._hideTimer = window.setTimeout(() => this.hide(), 260);
    } else if (!this._pinned) {
      this.hide();
    }
  }
}

function child(parent, tag, className) {
  const node = document.createElement(tag);
  node.className = className;
  parent.appendChild(node);
  return node;
}

function setLine(node, text) {
  if (text) {
    node.textContent = text;
    node.style.display = '';
  } else {
    node.textContent = '';
    node.style.display = 'none';
  }
}

function setLink(node, link) {
  if (link && link.href) {
    node.textContent = link.label || 'More info ↗';
    node.href = link.href;
    node.style.display = '';
  } else {
    node.removeAttribute('href');
    node.textContent = '';
    node.style.display = 'none';
  }
}
