/*
 * Vuga original vector artwork — local concept pack.
 * Every illustration is hand-authored SVG with a 96 × 96 coordinate system.
 * No fonts, emoji, remote assets, licensed symbol libraries, or runtime dependencies.
 * These are prototype illustrations, not clinically validated AAC symbols.
 * Vocabulary follows the repository draft where possible; local review is still needed.
 *
 * Browser: VUGA_ICONS, VUGA_SYMBOLS, VUGA_CATEGORIES.
 * Node/CommonJS: require('./icons.js') -> { VUGA_ICONS, SYMBOLS, CATEGORIES }.
 */
(function (root) {
  'use strict';

  const ink = '#233C3A';
  const teal = '#176B62';
  const yellow = '#F5CC66';
  const coral = '#EA987E';
  const lavender = '#C7BFE5';
  const mint = '#CFE8D8';
  const cream = '#FFF9ED';

  function svg(content) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96" fill="none" aria-hidden="true" focusable="false"><g fill="none" stroke="' + ink + '" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">' + content + '</g></svg>';
  }

  const icons = {
    water: svg(`
      <path d="M24 31h42l-4 44a7 7 0 0 1-7 6H35a7 7 0 0 1-7-6z" fill="${cream}"/>
      <path d="M27 49c9-7 17 6 26 0 4-3 8-3 12-1l-3 27a7 7 0 0 1-7 6H35a7 7 0 0 1-7-6z" fill="${mint}"/>
      <path d="M66 40h5a13 13 0 0 1 0 26h-7"/>
      <path d="M43 12c0 0-8 9-8 14a8 8 0 0 0 16 0c0-5-8-14-8-14z" fill="${teal}"/>
      <path d="M34 55l2 17" stroke="${cream}" stroke-width="4"/>
    `),
    food: svg(`
      <path d="M48 34c-21-17-39 5-31 28 5 16 15 25 25 20 4-2 8-2 12 0 10 5 20-4 25-20 8-23-10-45-31-28z" fill="${coral}"/>
      <path d="M48 35c0-13-4-18-8-21"/>
      <path d="M49 27c-1-14 12-21 25-16-2 13-12 21-25 16z" fill="${mint}"/>
      <path d="M51 27l13-9"/>
      <path d="M27 46c-4 4-5 9-3 15" stroke="${cream}" stroke-width="5"/>
    `),
    help: svg(`
      <path d="M34 81c-2-8-9-15-16-25-4-6 3-12 8-7l7 7V28c0-8 11-8 11 0v17-27c0-8 11-8 11 0v27-23c0-8 11-8 11 0v24-14c0-8 11-8 11 0v27c0 10-7 14-9 22z" fill="${yellow}"/>
      <path d="M44 45v8m11-8v8m11-7v7M35 62c8 0 14 5 14 12"/>
      <path d="M18 21l-5-5m63-2 4-5M20 34h-7" stroke="${teal}" stroke-width="4"/>
    `),
    stop: svg(`
      <path d="M34 81c-2-8-9-15-16-25-4-6 3-12 8-7l7 7V28c0-8 11-8 11 0v17-27c0-8 11-8 11 0v27-23c0-8 11-8 11 0v24-14c0-8 11-8 11 0v27c0 10-7 14-9 22z" fill="${coral}"/>
      <path d="M44 45v8m11-8v8m11-7v7"/>
      <path d="M42 65h22" stroke="${cream}" stroke-width="6"/>
    `),
    yes: svg(`
      <circle cx="48" cy="48" r="32" fill="${mint}"/>
      <path d="M31 48l12 12 23-25" stroke="${teal}" stroke-width="8"/>
      <path d="M77 20l5-5M84 33h6" stroke="${teal}"/>
    `),
    no: svg(`
      <circle cx="48" cy="48" r="32" fill="${coral}"/>
      <path d="M36 36l24 24M60 36 36 60" stroke-width="7"/>
    `),
    me: svg(`
      <path d="M20 81v-8c0-16 12-26 28-26s28 10 28 26v8z" fill="${lavender}"/>
      <circle cx="48" cy="30" r="17" fill="${yellow}"/>
      <path d="M33 23c4-13 24-17 30-1-7 2-14-1-18-6-3 5-7 7-12 7z" fill="${ink}"/>
      <circle cx="42" cy="30" r="1.5" fill="${ink}" stroke="none"/>
      <circle cx="54" cy="30" r="1.5" fill="${ink}" stroke="none"/>
      <path d="M43 37q5 5 10 0"/>
      <path d="M61 72H43m8-8-8 8 8 8" stroke="${teal}" stroke-width="5"/>
    `),
    want: svg(`
      <circle cx="60" cy="26" r="14" fill="${yellow}"/>
      <path d="M17 62h12l15-13c5-4 11 2 7 7l-5 5h21c10 0 13 11 5 16l-13 8H31L17 76z" fill="${mint}"/>
      <path d="M18 58H9v23h9z" fill="${teal}"/>
      <path d="M45 61h13M35 25h-8m13-12-5-6m42 2 5-5"/>
    `),
    play: svg(`
      <circle cx="48" cy="49" r="31" fill="${yellow}"/>
      <path d="m42 36 17 3 3 16-15 8-12-12z" fill="${cream}"/>
      <path d="M42 36l-5-16m22 19 14-8M62 55l13 9M47 63l-2 17M35 51l-17 5"/>
      <path d="M18 19l-5-5M11 34H6m74 47 4 4" stroke="${teal}"/>
    `),
    happy: svg(`
      <circle cx="48" cy="48" r="32" fill="${yellow}"/>
      <path d="M31 40q5-7 10 0m14 0q5-7 10 0"/>
      <path d="M33 55h30c-2 19-27 19-30 0z" fill="${cream}"/>
      <path d="M28 50h3m34 0h3" stroke="${coral}" stroke-width="6"/>
    `),
    sad: svg(`
      <circle cx="48" cy="48" r="32" fill="${lavender}"/>
      <path d="m32 38 8-4m16 0 8 4M36 60q12-10 24 0"/>
      <circle cx="36" cy="44" r="2" fill="${ink}" stroke="none"/>
      <circle cx="60" cy="44" r="2" fill="${ink}" stroke="none"/>
      <path d="M68 48s-5 7-5 10a5 5 0 0 0 10 0c0-3-5-10-5-10z" fill="${mint}"/>
    `),
    pain: svg(`
      <g transform="rotate(-35 48 48)">
        <rect x="13" y="32" width="70" height="32" rx="15" fill="${coral}"/>
        <rect x="36" y="32" width="24" height="32" rx="4" fill="${cream}"/>
        <path d="M24 43h1m-1 10h1m45-10h1m-1 10h1" stroke-width="4"/>
      </g>
      <path d="m60 13 2-6m12 16 7-2M23 76l-5 5" stroke="${teal}"/>
    `),
    toilet: svg(`
      <rect x="53" y="15" width="25" height="38" rx="5" fill="${mint}"/>
      <path d="M19 47h59v7c0 14-11 22-22 23l3 9H34l4-15C25 66 19 59 19 47z" fill="${cream}"/>
      <rect x="15" y="43" width="63" height="9" rx="4.5" fill="${lavender}"/>
      <path d="M62 26h7M22 86h43"/>
    `),
    home: svg(`
      <path d="M23 43h50v38H23z" fill="${mint}"/>
      <path d="m14 43 34-28 34 28-7 8-27-22-27 22z" fill="${coral}"/>
      <path d="M41 58h15v23H41z" fill="${cream}"/>
      <rect x="28" y="53" width="9" height="11" rx="2" fill="${yellow}"/>
      <path d="M66 28V16h10v20" fill="${coral}"/>
      <circle cx="51" cy="70" r="1.6" fill="${ink}" stroke="none"/>
      <path d="M17 82h62"/>
    `),
    people: svg(`
      <path d="M9 79V66c0-11 8-18 18-18s18 7 18 18v13z" fill="${coral}"/>
      <circle cx="27" cy="32" r="13" fill="${yellow}"/>
      <path d="M51 79V66c0-11 8-18 18-18s18 7 18 18v13z" fill="${mint}"/>
      <circle cx="69" cy="32" r="13" fill="${yellow}"/>
      <path d="M30 82V70c0-11 8-18 18-18s18 7 18 18v12z" fill="${lavender}"/>
      <circle cx="48" cy="39" r="13" fill="${cream}"/>
      <path d="M24 35q3 3 6 0m36 0q3 3 6 0m-27 7q3 3 6 0" stroke-width="2.5"/>
    `),
    feelings: svg(`
      <circle cx="34" cy="40" r="23" fill="${yellow}"/>
      <path d="M23 34h1m18 0h1m-18 12q9 10 18 0"/>
      <circle cx="62" cy="61" r="23" fill="${lavender}"/>
      <path d="M51 55h1m18 0h1M53 71q9-8 18 0"/>
    `),
    more: svg(`
      <rect x="17" y="17" width="27" height="27" rx="8" fill="${mint}"/>
      <rect x="52" y="17" width="27" height="27" rx="8" fill="${yellow}"/>
      <rect x="17" y="52" width="27" height="27" rx="8" fill="${lavender}"/>
      <path d="M65 53v24M53 65h24" stroke="${teal}" stroke-width="6"/>
    `),
    back: svg(`
      <path d="M38 25h42v46H38L15 48z" fill="${cream}"/>
      <path d="m49 39 18 18m0-18L49 57" stroke="${teal}" stroke-width="5"/>
    `),
    speaker: svg(`
      <path d="M14 37h16l23-18v58L30 59H14z" fill="${mint}"/>
      <path d="M30 37v22m35-26c10 8 10 22 0 30m11-41c17 15 17 37 0 52" stroke="${teal}" stroke-width="4"/>
    `),
    eye: svg(`
      <path d="M10 48s14-24 38-24 38 24 38 24-14 24-38 24S10 48 10 48z" fill="${cream}"/>
      <circle cx="48" cy="48" r="15" fill="${mint}"/>
      <circle cx="48" cy="48" r="6" fill="${teal}"/>
      <circle cx="51" cy="44" r="2" fill="${cream}" stroke="none"/>
    `),
    settings: svg(`
      <path d="M41 13h14l3 10 9 5 10-2 7 12-7 8v10l7 8-7 12-10-2-9 5-3 10H41l-3-10-9-5-10 2-7-12 7-8V46l-7-8 7-12 10 2 9-5z" fill="${mint}" transform="translate(0 -3)"/>
      <circle cx="48" cy="48" r="14" fill="${cream}"/>
    `),
    offline: svg(`
      <rect x="24" y="12" width="48" height="72" rx="10" fill="${cream}"/>
      <path d="M40 21h16M43 75h10"/>
      <circle cx="63" cy="58" r="20" fill="${mint}"/>
      <path d="m53 58 7 7 13-14" stroke="${teal}" stroke-width="5"/>
    `),
    leaf: svg(`
      <path d="M26 72C7 50 25 18 77 12c5 41-7 73-40 66z" fill="${mint}"/>
      <path d="M24 85c3-22 18-42 36-55" stroke="${teal}" stroke-width="4"/>
      <path d="M30 68l-7-12m20-5 15 4" stroke="${teal}"/>
      <circle cx="47" cy="35" r="2" fill="${ink}" stroke="none"/>
      <circle cx="67" cy="40" r="2" fill="${ink}" stroke="none"/>
      <path d="M54 43q5 6 10 1" stroke-width="2.5"/>
    `),
    finish: svg(`
      <path d="M25 82V16" stroke-width="5"/>
      <path d="M27 18h49L65 36l11 18H27z" fill="${lavender}"/>
      <path d="m39 35 7 7 15-16" stroke="${teal}" stroke-width="5"/>
      <path d="M16 83h21"/>
    `),
    thanks: svg(`
      <path d="M48 47S24 33 24 21c0-14 18-16 24-4 6-12 24-10 24 4 0 12-24 26-24 26z" fill="${coral}"/>
      <path d="M10 68h16l13-12c5-4 11 2 7 7l-4 4h24c10 0 13 11 5 15l-13 7H28L10 79z" fill="${mint}"/>
      <path d="M11 63H4v23h7z" fill="${teal}"/>
      <path d="M42 67h14"/>
    `)
  };

  // Semantic aliases intentionally reuse artwork rather than pretending to be
  // distinct validated representations. Personal photos may be preferable for people.
  icons.eat = icons.food;
  icons.drink = icons.water;
  icons.hurt = icons.pain;
  icons.show = icons.eye;
  icons.delete = icons.back;
  icons.core = icons.more;
  icons.actions = icons.play;

  const VUGA_ICONS = Object.freeze(icons);
  const makeSymbol = (id, label, en, category, icon) => Object.freeze({
    id, label, en, category, icon, svg: VUGA_ICONS[icon]
  });
  const SYMBOLS = Object.freeze([
    makeSymbol('I', 'Njye', 'I / me', 'core', 'me'),
    makeSymbol('WANT', 'Gushaka', 'Want', 'core', 'want'),
    makeSymbol('WATER', 'Amazi', 'Water', 'food', 'water'),
    makeSymbol('HELP', 'Gufasha', 'Help', 'core', 'help'),
    makeSymbol('YES', 'Yego', 'Yes', 'core', 'yes'),
    makeSymbol('NO', 'Oya', 'No', 'core', 'no'),
    makeSymbol('EAT', 'Kurya', 'Eat', 'actions', 'eat'),
    makeSymbol('DRINK', 'Kunywa', 'Drink', 'actions', 'drink'),
    makeSymbol('PLAY', 'Gukina', 'Play', 'actions', 'play'),
    makeSymbol('MORE', 'Ibindi', 'More', 'core', 'more'),
    makeSymbol('FINISH', 'Kurangiza', 'Finish', 'core', 'finish'),
    makeSymbol('TOILET', 'Umusarani', 'Toilet', 'places', 'toilet'),
    makeSymbol('HURT', 'Kubabara', 'Hurt', 'feelings', 'pain'),
    makeSymbol('THANK_YOU', 'Murakoze', 'Thank you', 'core', 'thanks'),
    makeSymbol('STOP', 'Guhagarika', 'Stop', 'core', 'stop'),
    makeSymbol('HAPPY', 'Kwishima', 'Happy', 'feelings', 'happy'),
    makeSymbol('SAD', 'Agahinda', 'Sad', 'feelings', 'sad'),
    makeSymbol('FOOD', 'Ibiryo', 'Food', 'food', 'food'),
    makeSymbol('MUM', 'Mama', 'Mum', 'people', 'people'),
    makeSymbol('DAD', 'Papa', 'Dad', 'people', 'people'),
    makeSymbol('TEACHER', 'Mwarimu', 'Teacher', 'people', 'people'),
    makeSymbol('FRIEND', 'Inshuti', 'Friend', 'people', 'people'),
    makeSymbol('HOME', 'Inzu', 'Home', 'places', 'home'),
    makeSymbol('SCHOOL', 'Ishuri', 'School', 'places', 'home')
  ]);
  const CATEGORIES = Object.freeze([
    { id: 'core', label: 'Ingenzi', en: 'Everyday', colour: yellow, svg: VUGA_ICONS.more },
    { id: 'food', label: 'Ibiryo', en: 'Food & drink', colour: coral, svg: VUGA_ICONS.food },
    { id: 'actions', label: 'Ibikorwa', en: 'Actions', colour: mint, svg: VUGA_ICONS.play },
    { id: 'feelings', label: 'Uko numva', en: 'Feelings', colour: lavender, svg: VUGA_ICONS.feelings },
    { id: 'people', label: 'Abantu', en: 'People', colour: yellow, svg: VUGA_ICONS.people },
    { id: 'places', label: 'Ahantu', en: 'Places', colour: mint, svg: VUGA_ICONS.home }
  ].map(Object.freeze));

  root.VUGA_ICONS = VUGA_ICONS;
  root.VUGA_SYMBOLS = SYMBOLS;
  root.VUGA_CATEGORIES = CATEGORIES;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { VUGA_ICONS, SYMBOLS, CATEGORIES };
  }
}(typeof window !== 'undefined' ? window : globalThis));
