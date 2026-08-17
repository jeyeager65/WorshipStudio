import type { Song } from '@/models/song'
import type { Service, RoleAssignment, ServiceTemplate } from '@/models/service'
import type { Person, Theme } from '@/models/library'
import type {
  RoleGroupDefinition,
  RoleDefinition,
  ServiceTypeDefinition,
  SongCollectionDefinition,
} from '@/models/settings'

// Fixed (not random) IDs, all under a `sample-` sub-prefix — this is what makes "Load Sample
// Data" idempotent: clicking it again just refreshes these same records in place (moving the
// service dates forward to whatever "today" is by then) rather than piling up duplicates.
// Real user-created content always uses crypto.randomUUID(), so these can never collide with it.

const now = new Date().toISOString()
const device = 'sample-data'

// Public-domain hymns only — real, singable text with no CCLI/copyright entanglement for a
// demo library, unlike using an actual contemporary worship song's lyrics would risk.
export const sampleSongs: Song[] = [
  {
    id: 'song-sample-amazing-grace',
    title: 'Amazing Grace',
    author: 'John Newton',
    collections: [{ collectionId: 'collection-sample-hymnal-one', number: '184' }],
    tags: ['Hymn', 'Public Domain'],
    blocks: [
      {
        id: 'v1',
        label: 'Verse 1',
        text: 'Amazing grace! How sweet the sound\nThat saved a wretch like me!\nI once was lost, but now am found,\nWas blind, but now I see.',
      },
      {
        id: 'v2',
        label: 'Verse 2',
        text: "'Twas grace that taught my heart to fear,\nAnd grace my fears relieved;\nHow precious did that grace appear\nThe hour I first believed.",
      },
      {
        id: 'v3',
        label: 'Verse 3',
        text: "Through many dangers, toils, and snares,\nI have already come;\n'Tis grace hath brought me safe thus far,\nAnd grace will lead me home.",
      },
      {
        id: 'v4',
        label: 'Verse 4',
        text: "When we've been there ten thousand years,\nBright shining as the sun,\nWe've no less days to sing God's praise\nThan when we'd first begun.",
      },
    ],
    defaultArrangement: { sequence: ['v1', 'v2', 'v3', 'v4'] },
    usage: { usesPastYear: 0 },
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'song-sample-holy-holy-holy',
    title: 'Holy, Holy, Holy',
    author: 'Reginald Heber',
    collections: [{ collectionId: 'collection-sample-hymnal-one', number: '1' }],
    tags: ['Hymn', 'Public Domain'],
    blocks: [
      {
        id: 'v1',
        label: 'Verse 1',
        text: 'Holy, holy, holy! Lord God Almighty!\nEarly in the morning our song shall rise to Thee;\nHoly, holy, holy, merciful and mighty!\nGod in three Persons, blessed Trinity!',
      },
      {
        id: 'v2',
        label: 'Verse 2',
        text: 'Holy, holy, holy! All the saints adore Thee,\nCasting down their golden crowns around the glassy sea;\nCherubim and seraphim falling down before Thee,\nWhich wert, and art, and evermore shalt be.',
      },
      {
        id: 'v3',
        label: 'Verse 3',
        text: 'Holy, holy, holy! Though the darkness hide Thee,\nThough the eye of sinful man Thy glory may not see,\nOnly Thou art holy; there is none beside Thee,\nPerfect in power, in love, and purity.',
      },
    ],
    defaultArrangement: { sequence: ['v1', 'v2', 'v3'] },
    usage: { usesPastYear: 0 },
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'song-sample-it-is-well',
    title: 'It Is Well with My Soul',
    author: 'Horatio Spafford',
    collections: [{ collectionId: 'collection-sample-hymnal-two', number: '410' }],
    tags: ['Hymn', 'Public Domain'],
    blocks: [
      {
        id: 'v1',
        label: 'Verse 1',
        text: 'When peace, like a river, attendeth my way,\nWhen sorrows like sea billows roll;\nWhatever my lot, Thou hast taught me to say,\nIt is well, it is well with my soul.',
      },
      {
        id: 'c1',
        label: 'Chorus',
        text: 'It is well, with my soul,\nIt is well, it is well, with my soul.',
      },
      {
        id: 'v2',
        label: 'Verse 2',
        text: 'Though Satan should buffet, though trials should come,\nLet this blest assurance control,\nThat Christ has regarded my helpless estate,\nAnd hath shed His own blood for my soul.',
      },
    ],
    defaultArrangement: { sequence: ['v1', 'c1', 'v2', 'c1'] },
    usage: { usesPastYear: 0 },
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'song-sample-great-is-thy-faithfulness',
    title: 'Great Is Thy Faithfulness',
    author: 'Thomas Chisholm',
    collections: [{ collectionId: 'collection-sample-hymnal-two', number: '58' }],
    tags: ['Hymn', 'Public Domain'],
    blocks: [
      {
        id: 'v1',
        label: 'Verse 1',
        text: 'Great is Thy faithfulness, O God my Father,\nThere is no shadow of turning with Thee;\nThou changest not, Thy compassions, they fail not;\nAs Thou hast been Thou forever wilt be.',
      },
      {
        id: 'c1',
        label: 'Chorus',
        text: 'Great is Thy faithfulness! Great is Thy faithfulness!\nMorning by morning new mercies I see;\nAll I have needed Thy hand hath provided—\nGreat is Thy faithfulness, Lord, unto me!',
      },
    ],
    defaultArrangement: { sequence: ['v1', 'c1'] },
    usage: { usesPastYear: 0 },
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'song-sample-blessed-assurance',
    title: 'Blessed Assurance',
    author: 'Fanny Crosby',
    collections: [{ collectionId: 'collection-sample-hymnal-one', number: '223' }],
    tags: ['Hymn', 'Public Domain'],
    blocks: [
      {
        id: 'v1',
        label: 'Verse 1',
        text: 'Blessed assurance, Jesus is mine!\nOh, what a foretaste of glory divine!\nHeir of salvation, purchase of God,\nBorn of His Spirit, washed in His blood.',
      },
      {
        id: 'c1',
        label: 'Chorus',
        text: 'This is my story, this is my song,\nPraising my Savior all the day long.',
      },
    ],
    defaultArrangement: { sequence: ['v1', 'c1'] },
    usage: { usesPastYear: 0 },
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'song-sample-come-thou-fount',
    title: 'Come Thou Fount of Every Blessing',
    author: 'Robert Robinson',
    collections: [{ collectionId: 'collection-sample-hymnal-one', number: '92' }],
    tags: ['Hymn', 'Public Domain'],
    blocks: [
      {
        id: 'v1',
        label: 'Verse 1',
        text: 'Come Thou Fount of every blessing,\nTune my heart to sing Thy grace;\nStreams of mercy, never ceasing,\nCall for songs of loudest praise.',
      },
      {
        id: 'v2',
        label: 'Verse 2',
        text: "Here I raise my Ebenezer;\nHither by Thy help I'm come;\nAnd I hope, by Thy good pleasure,\nSafely to arrive at home.",
      },
    ],
    defaultArrangement: { sequence: ['v1', 'v2'] },
    usage: { usesPastYear: 0 },
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'song-sample-how-firm-a-foundation',
    title: 'How Firm a Foundation',
    author: 'John Rippon',
    collections: [{ collectionId: 'collection-sample-hymnal-two', number: '150' }],
    tags: ['Hymn', 'Public Domain'],
    blocks: [
      {
        id: 'v1',
        label: 'Verse 1',
        text: 'How firm a foundation, ye saints of the Lord,\nIs laid for your faith in His excellent Word!\nWhat more can He say than to you He hath said,\nTo you who for refuge to Jesus have fled?',
      },
      {
        id: 'v2',
        label: 'Verse 2',
        text: "Fear not, I am with thee, O be not dismayed,\nFor I am thy God and will still give thee aid;\nI'll strengthen thee, help thee, and cause thee to stand,\nUpheld by My righteous, omnipotent hand.",
      },
    ],
    defaultArrangement: { sequence: ['v1', 'v2'] },
    usage: { usesPastYear: 0 },
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'song-sample-what-a-friend',
    title: 'What a Friend We Have in Jesus',
    author: 'Joseph Scriven',
    collections: [{ collectionId: 'collection-sample-hymnal-two', number: '345' }],
    tags: ['Hymn', 'Public Domain'],
    blocks: [
      {
        id: 'v1',
        label: 'Verse 1',
        text: 'What a friend we have in Jesus,\nAll our sins and griefs to bear!\nWhat a privilege to carry\nEverything to God in prayer!',
      },
      {
        id: 'v2',
        label: 'Verse 2',
        text: 'Have we trials and temptations?\nIs there trouble anywhere?\nWe should never be discouraged;\nTake it to the Lord in prayer.',
      },
    ],
    defaultArrangement: { sequence: ['v1', 'v2'] },
    usage: { usesPastYear: 0 },
    updatedAt: now,
    updatedByDevice: device,
  },
]

export const samplePeople: Person[] = [
  {
    id: 'person-sample-james-smith',
    firstName: 'James',
    lastName: 'Smith',
    preferredName: 'Jim',
    title: 'Pastor',
    preferredRoleIds: ['role-sample-sermon'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-sarah-mitchell',
    firstName: 'Sarah',
    lastName: 'Mitchell',
    preferredRoleIds: ['role-sample-vocals'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-marcus-johnson',
    firstName: 'Marcus',
    lastName: 'Johnson',
    preferredRoleIds: ['role-sample-piano'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-priya-patel',
    firstName: 'Priya',
    lastName: 'Patel',
    preferredRoleIds: ['role-sample-guitar'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-daniel-kim',
    firstName: 'Daniel',
    lastName: 'Kim',
    preferredRoleIds: ['role-sample-drums'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-rachel-nguyen',
    firstName: 'Rachel',
    lastName: 'Nguyen',
    preferredRoleIds: ['role-sample-sound-booth'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-tom-alvarez',
    firstName: 'Tom',
    lastName: 'Alvarez',
    preferredRoleIds: ['role-sample-scripture-reading'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-linda-brooks',
    firstName: 'Linda',
    lastName: 'Brooks',
    preferredRoleIds: ['role-sample-greeter', 'role-sample-nursery'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
]

export const sampleThemes: Theme[] = [
  {
    id: 'theme-sample-classic',
    name: 'Classic Hymn',
    font: 'Georgia',
    textColor: '#FFFFFF',
    outline: true,
    appliesTo: [],
    useAsDefaultFor: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'theme-sample-modern-light',
    name: 'Modern Light',
    font: 'Montserrat',
    textColor: '#1F3A5F',
    outline: false,
    appliesTo: [],
    useAsDefaultFor: [],
    updatedAt: now,
    updatedByDevice: device,
  },
]

/** Collections sampleSongs' collectionId fields reference by id — merged into its own
 *  song-collections.json, not LibrarySettings. "Hymnal Two" carries an abbreviation and
 *  "Hymnal One" doesn't, deliberately, so the seeded demo data shows both states: a collection
 *  whose bulletin citation uses its abbreviation and one that falls back to the bare name. */
export const sampleCollections: SongCollectionDefinition[] = [
  { id: 'collection-sample-hymnal-one', name: 'Hymnal One' },
  { id: 'collection-sample-hymnal-two', name: 'Hymnal Two', abbreviation: 'H2' },
]

/** Categories for sampleRoles below — merged into its own role-groups.json, not
 *  LibrarySettings. */
export const sampleRoleGroups: RoleGroupDefinition[] = [
  { id: 'group-sample-praise-team', name: 'Praise Team' },
  { id: 'group-sample-building', name: 'Building' },
  { id: 'group-sample-service-items', name: 'Service Items' },
  { id: 'group-sample-general', name: 'General' },
]

/** Every role used by samplePeople/rosters below — merged into its own roles.json, not
 *  LibrarySettings. */
export const sampleRoles: RoleDefinition[] = [
  { id: 'role-sample-drums', name: 'Drums', groupId: 'group-sample-praise-team' },
  { id: 'role-sample-guitar', name: 'Guitar', groupId: 'group-sample-praise-team' },
  { id: 'role-sample-piano', name: 'Piano', groupId: 'group-sample-praise-team' },
  { id: 'role-sample-vocals', name: 'Vocals', groupId: 'group-sample-praise-team' },
  { id: 'role-sample-open', name: 'Open', groupId: 'group-sample-building' },
  { id: 'role-sample-close', name: 'Close', groupId: 'group-sample-building' },
  {
    id: 'role-sample-welcome-announcements',
    name: 'Welcome and Announcements',
    groupId: 'group-sample-service-items',
  },
  {
    id: 'role-sample-scripture-reading',
    name: 'Scripture Reading',
    groupId: 'group-sample-service-items',
  },
  {
    id: 'role-sample-prayer-praise',
    name: 'Prayer of Praise and Confession',
    groupId: 'group-sample-service-items',
  },
  { id: 'role-sample-sermon', name: 'Sermon', groupId: 'group-sample-service-items' },
  {
    id: 'role-sample-prayer-thanksgiving',
    name: 'Prayer of Thanksgiving and Petition',
    groupId: 'group-sample-service-items',
  },
  { id: 'role-sample-greeter', name: 'Greeter', groupId: 'group-sample-general' },
  { id: 'role-sample-sound-booth', name: 'Sound Booth', groupId: 'group-sample-general' },
  { id: 'role-sample-nursery', name: 'Nursery', groupId: 'group-sample-general' },
  {
    id: 'role-sample-kids-k2',
    name: "Children's Church K-2",
    groupId: 'group-sample-general',
  },
  {
    id: 'role-sample-kids-34',
    name: "Children's Church 3-4",
    groupId: 'group-sample-general',
  },
]

/** Every service type sampleServices uses — merged into its own service-types.json, not
 *  LibrarySettings. */
export const sampleServiceTypes: ServiceTypeDefinition[] = [
  { id: 'type-sample-sunday-worship', name: 'Sunday Worship' },
  {
    id: 'type-sample-sunday-communion',
    name: 'Sunday Communion',
    description: "Includes the Lord's Supper",
  },
  { id: 'type-sample-other', name: 'Other' },
]

/** One example per templated service type — merged into LibrarySettings.serviceTemplates. Each
 *  mirrors a real printed bulletin's order (Welcome and Announcements through Closing Song),
 *  mixing bulletin-note items, content placeholders, a sermon placeholder, and role-only entries
 *  for roles with no line of their own in the order of service. 'Other' has no template — it's
 *  the free-form catch-all for anything that doesn't fit the two structured types. */
export const sampleServiceTemplates: ServiceTemplate[] = [
  {
    serviceType: 'Sunday Worship',
    description: 'The complete Sunday morning worship order, music through sermon to close.',
    defaultForServiceTypeIds: ['type-sample-sunday-worship'],
    items: [
      {
        id: 'tpl-welcome',
        kind: 'bulletin-note',
        label: 'Welcome and Announcements',
        roleId: 'role-sample-welcome-announcements',
      },
      {
        id: 'tpl-silent-prep',
        kind: 'bulletin-note',
        label: 'Silent Preparation',
        note: '(please spend the next few moments preparing your heart for corporate worship)',
      },
      { id: 'tpl-call-to-worship', kind: 'scripture', label: 'Scriptural Call to Worship' },
      { id: 'tpl-song-1', kind: 'song', label: '' },
      { id: 'tpl-song-2', kind: 'song', label: '' },
      {
        id: 'tpl-prayer-praise',
        kind: 'bulletin-note',
        label: 'Prayer of Praise and Confession',
        roleId: 'role-sample-prayer-praise',
      },
      { id: 'tpl-song-3', kind: 'song', label: '' },
      { id: 'tpl-song-4', kind: 'song', label: '' },
      {
        id: 'tpl-scripture-reading',
        kind: 'scripture',
        label: 'Scripture Reading',
        roleId: 'role-sample-scripture-reading',
      },
      {
        id: 'tpl-prayer-thanksgiving',
        kind: 'bulletin-note',
        label: 'Prayer of Thanksgiving and Petition',
        roleId: 'role-sample-prayer-thanksgiving',
      },
      { id: 'tpl-tithes-offering', kind: 'song', label: 'Tithes and Offerings' },
      {
        id: 'tpl-sermon',
        kind: 'sermon',
        label: 'Worship Through the Word',
        roleId: 'role-sample-sermon',
      },
      {
        id: 'tpl-silent-reflection',
        kind: 'bulletin-note',
        label: 'Silent Reflection',
        note: "(please spend the next few moments silently reflecting on today's service)",
      },
      { id: 'tpl-closing-song', kind: 'song', label: 'Closing Song' },
      { id: 'tpl-drums', kind: 'role-only', label: '', roleId: 'role-sample-drums' },
      { id: 'tpl-guitar', kind: 'role-only', label: '', roleId: 'role-sample-guitar' },
      { id: 'tpl-piano', kind: 'role-only', label: '', roleId: 'role-sample-piano' },
      { id: 'tpl-vocals', kind: 'role-only', label: '', roleId: 'role-sample-vocals', count: 2 },
      { id: 'tpl-greeter', kind: 'role-only', label: '', roleId: 'role-sample-greeter', count: 2 },
      { id: 'tpl-sound-booth', kind: 'role-only', label: '', roleId: 'role-sample-sound-booth' },
      { id: 'tpl-nursery', kind: 'role-only', label: '', roleId: 'role-sample-nursery', count: 2 },
      { id: 'tpl-kids-k2', kind: 'role-only', label: '', roleId: 'role-sample-kids-k2' },
      { id: 'tpl-kids-34', kind: 'role-only', label: '', roleId: 'role-sample-kids-34' },
      { id: 'tpl-open', kind: 'role-only', label: '', roleId: 'role-sample-open' },
      { id: 'tpl-close', kind: 'role-only', label: '', roleId: 'role-sample-close' },
    ],
  },
  {
    serviceType: 'Sunday Communion',
    description: "Communion Sunday's order, including the Lord's Supper before the close.",
    defaultForServiceTypeIds: ['type-sample-sunday-communion'],
    items: [
      {
        id: 'tpl-communion-welcome',
        kind: 'bulletin-note',
        label: 'Welcome and Announcements',
        roleId: 'role-sample-welcome-announcements',
      },
      {
        id: 'tpl-communion-silent-prep',
        kind: 'bulletin-note',
        label: 'Silent Preparation',
        note: '(please spend the next few moments preparing your heart for corporate worship)',
      },
      {
        id: 'tpl-communion-call-to-worship',
        kind: 'scripture',
        label: 'Scriptural Call to Worship',
      },
      { id: 'tpl-communion-song-1', kind: 'song', label: '' },
      {
        id: 'tpl-communion-prayer-praise',
        kind: 'bulletin-note',
        label: 'Prayer of Praise and Confession',
        roleId: 'role-sample-prayer-praise',
      },
      { id: 'tpl-communion-song-2', kind: 'song', label: '' },
      { id: 'tpl-communion-song-3', kind: 'song', label: '' },
      {
        id: 'tpl-communion-scripture-reading',
        kind: 'scripture',
        label: 'Scripture Reading',
        roleId: 'role-sample-scripture-reading',
      },
      {
        id: 'tpl-communion-prayer-thanksgiving',
        kind: 'bulletin-note',
        label: 'Prayer of Thanksgiving and Petition',
        roleId: 'role-sample-prayer-thanksgiving',
      },
      { id: 'tpl-communion-tithes-offering', kind: 'song', label: 'Tithes and Offerings' },
      {
        id: 'tpl-communion-sermon',
        kind: 'sermon',
        label: 'Worship Through the Word',
        roleId: 'role-sample-sermon',
      },
      { id: 'tpl-communion-song-4', kind: 'song', label: '' },
      {
        id: 'tpl-communion-lords-supper',
        kind: 'song',
        label: "The Lord's Supper",
        note: '(we will sing during the serving of the cup)',
      },
      { id: 'tpl-communion-closing-song', kind: 'song', label: 'Closing Song' },
      { id: 'tpl-communion-drums', kind: 'role-only', label: '', roleId: 'role-sample-drums' },
      { id: 'tpl-communion-guitar', kind: 'role-only', label: '', roleId: 'role-sample-guitar' },
      { id: 'tpl-communion-piano', kind: 'role-only', label: '', roleId: 'role-sample-piano' },
      {
        id: 'tpl-communion-vocals',
        kind: 'role-only',
        label: '',
        roleId: 'role-sample-vocals',
        count: 2,
      },
      {
        id: 'tpl-communion-greeter',
        kind: 'role-only',
        label: '',
        roleId: 'role-sample-greeter',
        count: 2,
      },
      {
        id: 'tpl-communion-sound-booth',
        kind: 'role-only',
        label: '',
        roleId: 'role-sample-sound-booth',
      },
      {
        id: 'tpl-communion-nursery',
        kind: 'role-only',
        label: '',
        roleId: 'role-sample-nursery',
        count: 2,
      },
      {
        id: 'tpl-communion-kids-k2',
        kind: 'role-only',
        label: '',
        roleId: 'role-sample-kids-k2',
      },
      {
        id: 'tpl-communion-kids-34',
        kind: 'role-only',
        label: '',
        roleId: 'role-sample-kids-34',
      },
      { id: 'tpl-communion-open', kind: 'role-only', label: '', roleId: 'role-sample-open' },
      { id: 'tpl-communion-close', kind: 'role-only', label: '', roleId: 'role-sample-close' },
    ],
  },
]

const toIso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

/** The most recent Sunday on/before `from` (0 days back if `from` itself is a Sunday). */
function lastSunday(from: Date): Date {
  const d = new Date(from)
  d.setDate(d.getDate() - d.getDay())
  return d
}

/** The Nth Sunday after `from` (1 = the next Sunday, possibly today if `from` is a Sunday). */
function nthSundayAfter(from: Date, n: number): Date {
  const d = new Date(from)
  const daysToNextSunday = (7 - d.getDay()) % 7 || 7
  d.setDate(d.getDate() + daysToNextSunday + 7 * (n - 1))
  return d
}

/** The next Wednesday on/after `from`. */
function nextWednesday(from: Date): Date {
  const d = new Date(from)
  d.setDate(d.getDate() + ((3 - d.getDay() + 7) % 7))
  return d
}

/** Builds the 4 sample services fresh against whatever "today" is when called — this is what
 *  makes re-running "Load Sample Data" refresh the demo to always-current dates rather than
 *  drifting into the past. */
export function buildSampleServices(referenceDate = new Date()): Service[] {
  const past = lastSunday(new Date(referenceDate.getTime() - 24 * 60 * 60 * 1000))
  const soon = nthSundayAfter(referenceDate, 1)
  const wednesday = nextWednesday(referenceDate)
  const future = nthSundayAfter(referenceDate, 3)

  const pastRoster: RoleAssignment[] = [
    { roleId: 'role-sample-sermon', personId: 'person-sample-james-smith', tentative: false },
    { roleId: 'role-sample-vocals', personId: 'person-sample-sarah-mitchell', tentative: false },
    { roleId: 'role-sample-piano', personId: 'person-sample-marcus-johnson', tentative: false },
    { roleId: 'role-sample-guitar', personId: 'person-sample-priya-patel', tentative: false },
    { roleId: 'role-sample-drums', personId: 'person-sample-daniel-kim', tentative: false },
    {
      roleId: 'role-sample-sound-booth',
      personId: 'person-sample-rachel-nguyen',
      tentative: false,
    },
    {
      roleId: 'role-sample-scripture-reading',
      personId: 'person-sample-tom-alvarez',
      tentative: false,
    },
  ]

  // Marcus is deliberately double-booked (Piano AND Open) — exercises the roster's
  // same-week-two-roles conflict detection (see rosterConflicts.ts).
  const soonRoster: RoleAssignment[] = [
    { roleId: 'role-sample-sermon', personId: 'person-sample-james-smith', tentative: false },
    { roleId: 'role-sample-vocals', personId: 'person-sample-sarah-mitchell', tentative: false },
    { roleId: 'role-sample-piano', personId: 'person-sample-marcus-johnson', tentative: false },
    { roleId: 'role-sample-open', personId: 'person-sample-marcus-johnson', tentative: false },
    { roleId: 'role-sample-guitar', personId: 'person-sample-priya-patel', tentative: true },
    {
      roleId: 'role-sample-sound-booth',
      personId: 'person-sample-rachel-nguyen',
      tentative: false,
    },
    { roleId: 'role-sample-greeter', personId: 'person-sample-linda-brooks', tentative: false },
  ]

  return [
    {
      id: 'service-sample-past-sunday',
      date: toIso(past),
      time: '10:30',
      serviceTypeId: 'type-sample-sunday-worship',
      items: [
        {
          id: 'item-2',
          type: 'song',
          songId: 'song-sample-come-thou-fount',
          arrangement: { sequence: ['v1', 'v2'] },
        },
        {
          id: 'item-3',
          type: 'song',
          songId: 'song-sample-great-is-thy-faithfulness',
          arrangement: { sequence: ['v1', 'c1', 'c1'] },
        },
        {
          id: 'item-4',
          type: 'scripture',
          reference: 'Hebrews 11:1-6',
          translation: 'KJV',
          displayMode: 'full',
        },
        {
          id: 'item-5',
          type: 'text-slide',
          slides: [
            { id: 's1', label: 'Welcome', text: "Welcome! We're glad you're here." },
            {
              id: 's2',
              label: 'Announcement',
              text: 'Potluck next Sunday after the service — bring a dish to share!',
            },
          ],
        },
        {
          id: 'item-6',
          type: 'song',
          songId: 'song-sample-blessed-assurance',
          arrangement: { sequence: ['v1', 'c1', 'c1'] },
        },
        {
          id: 'item-sermon',
          type: 'sermon',
          title: 'Walking in Faith',
          passages: [
            {
              id: 'passage-sermon',
              reference: 'Hebrews 11:1-6',
              translation: 'KJV',
              displayMode: 'full',
            },
          ],
          mainPassageId: 'passage-sermon',
          outline: [],
          roleId: 'role-sample-sermon',
        },
      ],
      assignments: pastRoster,
      updatedAt: now,
      updatedByDevice: device,
    },
    {
      id: 'service-sample-upcoming-sunday',
      date: toIso(soon),
      time: '10:30',
      serviceTypeId: 'type-sample-sunday-worship',
      items: [
        {
          id: 'item-2',
          type: 'song',
          songId: 'song-sample-holy-holy-holy',
          arrangement: { sequence: ['v1', 'v2', 'v3'] },
        },
        {
          id: 'item-3',
          type: 'song',
          songId: 'song-sample-it-is-well',
          arrangement: { sequence: ['v1', 'c1', 'v2', 'c1'] },
        },
        {
          id: 'item-4',
          type: 'scripture',
          reference: 'Psalm 23',
          translation: 'KJV',
          displayMode: 'reference-only',
        },
        {
          id: 'item-5',
          type: 'text-slide',
          slides: [
            {
              id: 's1',
              label: 'Announcement',
              text: 'Vacation Bible School registration is now open — sign up at the welcome desk.',
            },
          ],
        },
        {
          id: 'item-6',
          type: 'song',
          songId: 'song-sample-amazing-grace',
          arrangement: { sequence: ['v1', 'v2', 'v3', 'v4'] },
        },
        {
          id: 'item-sermon',
          type: 'sermon',
          title: 'The Good Shepherd',
          passages: [
            {
              id: 'passage-sermon',
              reference: 'Psalm 23',
              translation: 'KJV',
              displayMode: 'reference-only',
            },
          ],
          mainPassageId: 'passage-sermon',
          outline: [],
          roleId: 'role-sample-sermon',
        },
      ],
      assignments: soonRoster,
      updatedAt: now,
      updatedByDevice: device,
    },
    {
      id: 'service-sample-wednesday-study',
      date: toIso(wednesday),
      time: '19:00',
      serviceTypeId: 'type-sample-other',
      items: [
        {
          id: 'item-1',
          type: 'song',
          songId: 'song-sample-how-firm-a-foundation',
          arrangement: { sequence: ['v1', 'v2'] },
        },
        {
          id: 'item-2',
          type: 'scripture',
          reference: 'Romans 8:28-39',
          translation: 'KJV',
          displayMode: 'full',
        },
        {
          id: 'item-sermon',
          type: 'sermon',
          title: 'Romans 8: Grace and Faith',
          passages: [
            {
              id: 'passage-sermon',
              reference: 'Romans 8:28-39',
              translation: 'KJV',
              displayMode: 'full',
            },
          ],
          mainPassageId: 'passage-sermon',
          outline: [],
          roleId: 'role-sample-sermon',
        },
      ],
      assignments: [
        { roleId: 'role-sample-sermon', personId: 'person-sample-james-smith', tentative: false },
        {
          roleId: 'role-sample-sound-booth',
          personId: 'person-sample-rachel-nguyen',
          tentative: false,
        },
      ],
      updatedAt: now,
      updatedByDevice: device,
    },
    {
      // Deliberately sparse — sermon/preacher not yet decided, only one role assigned so far,
      // to show what a service still mid-planning realistically looks like.
      id: 'service-sample-future-sunday',
      date: toIso(future),
      time: '10:30',
      serviceTypeId: 'type-sample-sunday-worship',
      items: [
        {
          id: 'item-1',
          type: 'song',
          songId: 'song-sample-what-a-friend',
          arrangement: { sequence: ['v1', 'v2'] },
        },
      ],
      assignments: [
        { roleId: 'role-sample-vocals', personId: 'person-sample-sarah-mitchell', tentative: true },
      ],
      updatedAt: now,
      updatedByDevice: device,
    },
  ]
}
