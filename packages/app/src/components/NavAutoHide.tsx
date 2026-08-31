'use client';

// The v2 navigation pill is position:fixed. On the home page that is fine —
// it floats over full-bleed sections. On a long text page it would sit on top
// of a paragraph the whole way down.
//
// landing-v2.css has always shipped `.v2-nav.hidden` (a translate off the top
// with a transition) and nothing ever set the class. This wires it up: hide
// on the way down past the first screen, show again the moment the reader
// scrolls up. Mounted once in the root layout, so it covers the home page's
// own nav as well as the shared <NavBar />.

import { useEffect } from 'react';

const SHOW_ABOVE = 240; // px — never hide while the header is still in view

export function NavAutoHide() {
  useEffect(() => {
    const nav = document.querySelector('.v2-nav');
    if (!nav) return;
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (y > last && y > SHOW_ABOVE) nav.classList.add('hidden');
      else if (y < last) nav.classList.remove('hidden');
      last = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return null;
}
