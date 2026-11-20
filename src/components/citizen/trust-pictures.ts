/** CIT-1 / CIT-8: 30 trust pictures. Helpers see avatars (a separate set), never trust pictures (HELP-1). */
export const TRUST_PICTURES = ['🌙', '🌳', '🐐', '🌻', '🐟', '🏺', '🕌', '🐄', '🌾', '🦜', '🍋', '🐪', '⛵', '🌺', '🐓', '🍉', '🌴', '🔔', '🐑', '🥭',
  '🪔', '🦚', '🍎', '🐢', '🌈', '🏔️', '🧺', '🐝', '🌷', '⭐'] as const;
export const AVATARS = ['🟢', '🔵', '🟣', '🟠', '🟡', '🔴', '🟤', '⚫', '🔶', '🔷', '🔺', '🔻', '◆', '●', '■', '▲', '★', '♦', '♣', '♠',
  '☀', '☁', '☂', '☘', '✿', '❖', '✦', '✧', '✪', '✸'] as const;

export const trustPicture = (id: number | null | undefined) => (id && id >= 1 && id <= 30 ? TRUST_PICTURES[id - 1] : '·');
export const avatar = (id: number | null | undefined) => (id && id >= 1 && id <= 30 ? AVATARS[id - 1] : '○');
