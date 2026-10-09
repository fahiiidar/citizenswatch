// Names, colours and wording shared across screens.

export const CATS = {
  gunmen: { name: 'Gunmen sighted', icon: 'eye', tone: 'red' },
  kidnapping: { name: 'Kidnapping', icon: 'userx', tone: 'red' },
  attack: { name: 'Attack happening', icon: 'flame', tone: 'red' },
  road: { name: 'Road unsafe', icon: 'street', tone: 'amber' },
  robbery: { name: 'Robbery', icon: 'bag', tone: 'amber' },
  avoid: { name: 'Area to avoid', icon: 'ban', tone: 'amber' },
  officials: { name: 'Harassment by officials', icon: 'badge', tone: 'amber' },
  clear: { name: 'All clear', icon: 'shield', tone: 'green' },
  other: { name: 'Something else', icon: 'more', tone: 'grey' },
};
export const CAT_KEYS = Object.keys(CATS);

// Who was involved, for "Harassment by officials".
export const AGENCIES = {
  police: 'Police',
  army: 'Army',
  lastma: 'LASTMA',
  ndlea: 'NDLEA',
  frsc: 'FRSC',
  vio: 'VIO',
  customs: 'Customs',
  immigration: 'Immigration',
  nscdc: 'Civil Defence',
  hisbah: 'Hisbah',
  vigilante: 'Vigilante',
  taskforce: 'State task force',
  other: 'Other agency',
};

// "Harassment by officials · Police"
export function catTitle(r) {
  const c = CATS[r.category] || CATS.other;
  return r.category === 'officials' && r.agency ? `${c.name} · ${AGENCIES[r.agency] || 'Other agency'}` : c.name;
}
export const TONE_COLOR = { red: '#D92D20', amber: '#DC6803', green: '#079455', grey: '#667085' };

export const STATUS = {
  unverified: 'Unverified',
  corroborated: 'Corroborated',
  disputed: 'Disputed',
};

export const RANGES = {
  '1h': 'Last hour',
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
};

export const TIME_OF_DAY = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', night: 'Night' };

export const FLAG_REASONS = {
  face: 'Shows someone’s face or identity',
  graphic: 'Too graphic or upsetting',
  hate: 'Hate, blame or calls for revenge',
  old: 'Old or reused photo',
  spam: 'Spam or a joke',
  other: 'Something else is wrong',
};

// Text behind every small (i) button in the app.
export const TIPS = {
  corroborated: {
    title: 'Corroborated',
    text: 'At least 3 different people nearby confirmed this report. It is more likely true, but still use your judgement.',
  },
  unverified: {
    title: 'Unverified',
    text: 'Just posted, and fewer than 3 people have confirmed it. Treat it as a warning, not a fact.',
  },
  disputed: {
    title: 'Disputed',
    text: 'More people said this is false or old than confirmed it. Be careful before sharing it.',
  },
  live: {
    title: 'Live now',
    text: 'Reports marked as happening now, posted in the last hour.',
  },
  total: {
    title: 'Reports',
    text: 'Every visible report in the time range you chose. Hidden and removed reports are not counted.',
  },
  approx: {
    title: 'Why the place is approximate',
    text: 'To protect the person who posted, the map shows an area of about 1 km, never the exact spot they stood.',
  },
  rules: {
    title: 'Posting rules',
    text: 'Say what happened and where. Do not name people, blame an ethnic or religious group, or reveal where soldiers, police or people hiding are. Posts that break these rules are removed.',
  },
  photoData: {
    title: 'What we remove from photos',
    text: 'Photos and clips are re-made on your phone before upload, which strips the hidden location, time and phone model. Sound is removed from clips unless you keep it.',
  },
  limit: {
    title: 'Why there is a limit',
    text: 'Up to 3 reports an hour from each phone stops one person flooding the map with fake reports.',
  },
  timeOfDay: {
    title: 'Why not an exact time?',
    text: 'A rough time is enough to warn people, and it is easier to remember. It also protects you if someone is checking who was where.',
  },
  older: {
    title: 'Older reports',
    text: 'On longer time ranges, older reports show lighter on the map so the most recent danger stands out.',
  },
  sound: {
    title: 'Why sound is off',
    text: 'Voices can identify you or the people around you. Keep sound only if it matters, like gunshots or warnings being shouted.',
  },
  sensitive: {
    title: 'Sensitive media',
    text: 'Turn this on if your photo or clip shows injuries or bodies. It will be blurred until someone chooses to view it.',
  },
  oldPhoto: {
    title: 'Photo may be old',
    text: 'The phone that posted this found that the photo or clip was taken at least a day before the event. It could be recycled from an older incident. Moderators review these first.',
  },
  updates: {
    title: 'Updates from others',
    text: 'People nearby can add their own photos or words to a report. Each update also counts as a confirmation. Updates are checked the same way as reports.',
  },
  officials: {
    title: 'Harassment by officials',
    text: 'Extortion, beatings, illegal arrests or phone searches by police, soldiers, LASTMA, NDLEA or other officials. Describe what happened, not who: no names or badge numbers.',
  },
  anonymous: {
    title: 'How you stay anonymous',
    text: 'There is no account. We never store your name, phone number, exact location or internet address.',
  },
};

export function timeAgo(iso, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export function shortAgo(iso, now = Date.now()) {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' });
const CLOCK = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });

export function lagosDate(ms = Date.now()) {
  return new Date(ms + 3600e3).toISOString().slice(0, 10);
}

// "Today 15:40", "Yesterday, afternoon", "3 Oct, evening"
export function whenLabel(r, now = Date.now()) {
  const today = lagosDate(now);
  const yesterday = lagosDate(now - 86400e3);
  if (r.is_now) {
    const day = lagosDate(Date.parse(r.created_at)) === today ? 'Today' : DAY.format(new Date(r.created_at));
    return `${day} ${CLOCK.format(new Date(r.created_at))}`;
  }
  const day = r.occurred_on === today ? 'Today' : r.occurred_on === yesterday ? 'Yesterday'
    : DAY.format(new Date(`${r.occurred_on}T12:00:00Z`));
  return r.time_of_day ? `${day}, ${TIME_OF_DAY[r.time_of_day].toLowerCase()}` : day;
}

export function rangeTitle(filters) {
  if (filters.range === 'custom' && filters.from && filters.to) {
    const f = DAY.format(new Date(`${filters.from}T12:00:00Z`));
    const t = DAY.format(new Date(`${filters.to}T12:00:00Z`));
    return f === t ? f : `${f} – ${t}`;
  }
  return RANGES[filters.range] || RANGES['24h'];
}

export function whereLabel(r) {
  return r.area_label && !r.place_label.includes(r.area_label.split(',')[0])
    ? `${r.place_label}, ${r.area_label.split(',')[0]}`
    : r.place_label;
}
