import type { Song } from '@/models/song'
import type { Service, RoleAssignment } from '@/models/service'
import type { Volunteer, Theme } from '@/models/library'

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
    collections: [{ collectionId: 'Hymns of Grace', number: '184' }],
    tags: ['hymn'],
    blocks: [
      { id: 'v1', label: 'Verse 1', text: 'Amazing grace! How sweet the sound\nThat saved a wretch like me!\nI once was lost, but now am found,\nWas blind, but now I see.' },
      { id: 'v2', label: 'Verse 2', text: "'Twas grace that taught my heart to fear,\nAnd grace my fears relieved;\nHow precious did that grace appear\nThe hour I first believed." },
      { id: 'v3', label: 'Verse 3', text: "Through many dangers, toils, and snares,\nI have already come;\n'Tis grace hath brought me safe thus far,\nAnd grace will lead me home." },
      { id: 'v4', label: 'Verse 4', text: "When we've been there ten thousand years,\nBright shining as the sun,\nWe've no less days to sing God's praise\nThan when we'd first begun." },
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
    collections: [{ collectionId: 'Hymns of Grace', number: '1' }],
    tags: ['hymn'],
    blocks: [
      { id: 'v1', label: 'Verse 1', text: 'Holy, holy, holy! Lord God Almighty!\nEarly in the morning our song shall rise to Thee;\nHoly, holy, holy, merciful and mighty!\nGod in three Persons, blessed Trinity!' },
      { id: 'v2', label: 'Verse 2', text: 'Holy, holy, holy! All the saints adore Thee,\nCasting down their golden crowns around the glassy sea;\nCherubim and seraphim falling down before Thee,\nWhich wert, and art, and evermore shalt be.' },
      { id: 'v3', label: 'Verse 3', text: 'Holy, holy, holy! Though the darkness hide Thee,\nThough the eye of sinful man Thy glory may not see,\nOnly Thou art holy; there is none beside Thee,\nPerfect in power, in love, and purity.' },
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
    collections: [{ collectionId: 'Worship Hymnal', number: '410' }],
    tags: ['hymn'],
    blocks: [
      { id: 'v1', label: 'Verse 1', text: 'When peace, like a river, attendeth my way,\nWhen sorrows like sea billows roll;\nWhatever my lot, Thou hast taught me to say,\nIt is well, it is well with my soul.' },
      { id: 'c1', label: 'Chorus', text: 'It is well, with my soul,\nIt is well, it is well, with my soul.' },
      { id: 'v2', label: 'Verse 2', text: 'Though Satan should buffet, though trials should come,\nLet this blest assurance control,\nThat Christ has regarded my helpless estate,\nAnd hath shed His own blood for my soul.' },
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
    collections: [{ collectionId: 'Worship Hymnal', number: '58' }],
    tags: ['hymn'],
    blocks: [
      { id: 'v1', label: 'Verse 1', text: 'Great is Thy faithfulness, O God my Father,\nThere is no shadow of turning with Thee;\nThou changest not, Thy compassions, they fail not;\nAs Thou hast been Thou forever wilt be.' },
      { id: 'c1', label: 'Chorus', text: 'Great is Thy faithfulness! Great is Thy faithfulness!\nMorning by morning new mercies I see;\nAll I have needed Thy hand hath provided—\nGreat is Thy faithfulness, Lord, unto me!' },
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
    collections: [{ collectionId: 'Hymns of Grace', number: '223' }],
    tags: ['hymn'],
    blocks: [
      { id: 'v1', label: 'Verse 1', text: 'Blessed assurance, Jesus is mine!\nOh, what a foretaste of glory divine!\nHeir of salvation, purchase of God,\nBorn of His Spirit, washed in His blood.' },
      { id: 'c1', label: 'Chorus', text: 'This is my story, this is my song,\nPraising my Savior all the day long.' },
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
    collections: [{ collectionId: 'Hymns of Grace', number: '92' }],
    tags: ['hymn'],
    blocks: [
      { id: 'v1', label: 'Verse 1', text: 'Come Thou Fount of every blessing,\nTune my heart to sing Thy grace;\nStreams of mercy, never ceasing,\nCall for songs of loudest praise.' },
      { id: 'v2', label: 'Verse 2', text: "Here I raise my Ebenezer;\nHither by Thy help I'm come;\nAnd I hope, by Thy good pleasure,\nSafely to arrive at home." },
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
    collections: [{ collectionId: 'Worship Hymnal', number: '150' }],
    tags: ['hymn'],
    blocks: [
      { id: 'v1', label: 'Verse 1', text: 'How firm a foundation, ye saints of the Lord,\nIs laid for your faith in His excellent Word!\nWhat more can He say than to you He hath said,\nTo you who for refuge to Jesus have fled?' },
      { id: 'v2', label: 'Verse 2', text: "Fear not, I am with thee, O be not dismayed,\nFor I am thy God and will still give thee aid;\nI'll strengthen thee, help thee, and cause thee to stand,\nUpheld by My righteous, omnipotent hand." },
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
    collections: [{ collectionId: 'Worship Hymnal', number: '345' }],
    tags: ['hymn'],
    blocks: [
      { id: 'v1', label: 'Verse 1', text: 'What a friend we have in Jesus,\nAll our sins and griefs to bear!\nWhat a privilege to carry\nEverything to God in prayer!' },
      { id: 'v2', label: 'Verse 2', text: 'Have we trials and temptations?\nIs there trouble anywhere?\nWe should never be discouraged;\nTake it to the Lord in prayer.' },
    ],
    defaultArrangement: { sequence: ['v1', 'v2'] },
    usage: { usesPastYear: 0 },
    updatedAt: now,
    updatedByDevice: device,
  },
]

export const sampleVolunteers: Volunteer[] = [
  { id: 'volunteer-sample-sarah-mitchell', firstName: 'Sarah', lastName: 'Mitchell', preferredRoles: ['Worship Leader', 'Vocals'], unavailableDateRanges: [], updatedAt: now, updatedByDevice: device },
  { id: 'volunteer-sample-marcus-johnson', firstName: 'Marcus', lastName: 'Johnson', preferredRoles: ['Piano', 'Slides'], unavailableDateRanges: [], updatedAt: now, updatedByDevice: device },
  { id: 'volunteer-sample-priya-patel', firstName: 'Priya', lastName: 'Patel', preferredRoles: ['Guitar'], unavailableDateRanges: [], updatedAt: now, updatedByDevice: device },
  { id: 'volunteer-sample-daniel-kim', firstName: 'Daniel', lastName: 'Kim', preferredRoles: ['Drums'], unavailableDateRanges: [], updatedAt: now, updatedByDevice: device },
  { id: 'volunteer-sample-rachel-nguyen', firstName: 'Rachel', lastName: 'Nguyen', preferredRoles: ['Sound Booth'], unavailableDateRanges: [], updatedAt: now, updatedByDevice: device },
  { id: 'volunteer-sample-tom-alvarez', firstName: 'Tom', lastName: 'Alvarez', preferredRoles: ['Slides'], unavailableDateRanges: [], updatedAt: now, updatedByDevice: device },
  { id: 'volunteer-sample-linda-brooks', firstName: 'Linda', lastName: 'Brooks', preferredRoles: ['Greeter', 'Nursery'], unavailableDateRanges: [], updatedAt: now, updatedByDevice: device },
]

export const sampleThemes: Theme[] = [
  {
    id: 'theme-sample-classic',
    name: 'Classic Hymn',
    font: 'Georgia',
    textColor: '#FFFFFF',
    outline: true,
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
    useAsDefaultFor: [],
    updatedAt: now,
    updatedByDevice: device,
  },
]

/** Every role used by sampleVolunteers/rosters below — merged into LibrarySettings.volunteerRoles. */
export const sampleVolunteerRoles = ['Worship Leader', 'Vocals', 'Piano', 'Guitar', 'Drums', 'Sound Booth', 'Slides', 'Greeter', 'Nursery']

/** Every service type sampleServices uses — merged into LibrarySettings.serviceTypes. */
export const sampleServiceTypes = ['Sunday Morning Worship', 'Wednesday Bible Study']

const toIso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

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

function countdownTarget(date: Date, hour: number, minute: number): string {
  const d = new Date(date)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
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
    { role: 'Worship Leader', volunteerId: 'volunteer-sample-sarah-mitchell', tentative: false },
    { role: 'Piano', volunteerId: 'volunteer-sample-marcus-johnson', tentative: false },
    { role: 'Guitar', volunteerId: 'volunteer-sample-priya-patel', tentative: false },
    { role: 'Drums', volunteerId: 'volunteer-sample-daniel-kim', tentative: false },
    { role: 'Sound Booth', volunteerId: 'volunteer-sample-rachel-nguyen', tentative: false },
    { role: 'Slides', volunteerId: 'volunteer-sample-tom-alvarez', tentative: false },
  ]

  // Marcus is deliberately double-booked (Piano AND Slides) — exercises the roster's
  // same-week-two-roles conflict detection (see volunteerConflicts.ts).
  const soonRoster: RoleAssignment[] = [
    { role: 'Worship Leader', volunteerId: 'volunteer-sample-sarah-mitchell', tentative: false },
    { role: 'Piano', volunteerId: 'volunteer-sample-marcus-johnson', tentative: false },
    { role: 'Slides', volunteerId: 'volunteer-sample-marcus-johnson', tentative: false },
    { role: 'Guitar', volunteerId: 'volunteer-sample-priya-patel', tentative: true },
    { role: 'Sound Booth', volunteerId: 'volunteer-sample-rachel-nguyen', tentative: false },
    { role: 'Greeter', volunteerId: 'volunteer-sample-linda-brooks', tentative: false },
  ]

  return [
    {
      id: 'service-sample-past-sunday',
      date: toIso(past),
      type: 'Sunday Morning Worship',
      preacher: 'Pastor Dan',
      sermonTitle: 'Walking in Faith',
      keyPassage: 'Hebrews 11:1-6',
      items: [
        { id: 'item-1', type: 'countdown', targetTime: countdownTarget(past, 9, 25), text: 'Service begins soon' },
        { id: 'item-2', type: 'song', songId: 'song-sample-come-thou-fount', arrangement: { sequence: ['v1', 'v2'] } },
        { id: 'item-3', type: 'song', songId: 'song-sample-great-is-thy-faithfulness', arrangement: { sequence: ['v1', 'c1', 'c1'] } },
        { id: 'item-4', type: 'scripture', reference: 'Hebrews 11:1-6', translation: 'KJV', displayMode: 'full' },
        {
          id: 'item-5',
          type: 'text-slide',
          slides: [
            { id: 's1', label: 'Welcome', text: "Welcome! We're glad you're here." },
            { id: 's2', label: 'Announcement', text: 'Potluck next Sunday after the service — bring a dish to share!' },
          ],
        },
        { id: 'item-6', type: 'song', songId: 'song-sample-blessed-assurance', arrangement: { sequence: ['v1', 'c1', 'c1'] } },
      ],
      volunteerRoster: pastRoster,
      updatedAt: now,
      updatedByDevice: device,
    },
    {
      id: 'service-sample-upcoming-sunday',
      date: toIso(soon),
      type: 'Sunday Morning Worship',
      preacher: 'Pastor Dan',
      sermonTitle: 'The Good Shepherd',
      keyPassage: 'Psalm 23',
      items: [
        { id: 'item-1', type: 'countdown', targetTime: countdownTarget(soon, 9, 25), text: 'Service begins soon' },
        { id: 'item-2', type: 'song', songId: 'song-sample-holy-holy-holy', arrangement: { sequence: ['v1', 'v2', 'v3'] } },
        { id: 'item-3', type: 'song', songId: 'song-sample-it-is-well', arrangement: { sequence: ['v1', 'c1', 'v2', 'c1'] } },
        { id: 'item-4', type: 'scripture', reference: 'Psalm 23', translation: 'KJV', displayMode: 'reference-only' },
        {
          id: 'item-5',
          type: 'text-slide',
          slides: [{ id: 's1', label: 'Announcement', text: 'Vacation Bible School registration is now open — sign up at the welcome desk.' }],
        },
        { id: 'item-6', type: 'song', songId: 'song-sample-amazing-grace', arrangement: { sequence: ['v1', 'v2', 'v3', 'v4'] } },
      ],
      volunteerRoster: soonRoster,
      updatedAt: now,
      updatedByDevice: device,
    },
    {
      id: 'service-sample-wednesday-study',
      date: toIso(wednesday),
      type: 'Wednesday Bible Study',
      preacher: 'Pastor Dan',
      sermonTitle: 'Romans 8: Grace and Faith',
      keyPassage: 'Romans 8:28-39',
      items: [
        { id: 'item-1', type: 'song', songId: 'song-sample-how-firm-a-foundation', arrangement: { sequence: ['v1', 'v2'] } },
        { id: 'item-2', type: 'scripture', reference: 'Romans 8:28-39', translation: 'KJV', displayMode: 'full' },
      ],
      volunteerRoster: [{ role: 'Sound Booth', volunteerId: 'volunteer-sample-rachel-nguyen', tentative: false }],
      updatedAt: now,
      updatedByDevice: device,
    },
    {
      // Deliberately sparse — sermon/preacher not yet decided, only one role assigned so far,
      // to show what a service still mid-planning realistically looks like.
      id: 'service-sample-future-sunday',
      date: toIso(future),
      type: 'Sunday Morning Worship',
      items: [{ id: 'item-1', type: 'song', songId: 'song-sample-what-a-friend', arrangement: { sequence: ['v1', 'v2'] } }],
      volunteerRoster: [{ role: 'Worship Leader', volunteerId: 'volunteer-sample-sarah-mitchell', tentative: true }],
      updatedAt: now,
      updatedByDevice: device,
    },
  ]
}
