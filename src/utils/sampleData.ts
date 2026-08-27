import type { Song } from '@/models/song'
import type { Service, ServiceItem, RoleAssignment, ServiceTemplate } from '@/models/service'
import type { Person, Theme } from '@/models/library'
import type {
  RoleGroupDefinition,
  RoleDefinition,
  ServiceTypeDefinition,
  SongCollectionDefinition,
} from '@/models/settings'
import { songIdsInService } from '@/utils/songUsage'

// Fixed (not random) IDs, all under a `sample-` sub-prefix — this is what makes "Load Sample
// Data" idempotent: clicking it again just refreshes these same records in place (moving the
// service dates forward to whatever "today" is by then) rather than piling up duplicates.
// Real user-created content always uses crypto.randomUUID(), so these can never collide with it.

const now = new Date().toISOString()
const device = 'sample-data'

/** Date-only ISO string N days from today, so unavailability windows below stay in the future
 *  instead of drifting into the past the way hardcoded dates would. Same reasoning as
 *  buildSampleServices' relative dates. */
function daysFromNow(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

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
    usageDates: [],
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
    usageDates: [],
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
    usageDates: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'song-sample-praise-to-the-lord',
    title: 'Praise to the Lord, the Almighty',
    author: 'Joachim Neander, tr. Catherine Winkworth',
    collections: [{ collectionId: 'collection-sample-hymnal-two', number: '58' }],
    tags: ['Hymn', 'Public Domain'],
    blocks: [
      {
        id: 'v1',
        label: 'Verse 1',
        text: 'Praise to the Lord, the Almighty, the King of creation!\nO my soul, praise Him, for He is thy health and salvation!\nAll ye who hear, now to His temple draw near;\nJoin me in glad adoration!',
      },
      {
        id: 'v2',
        label: 'Verse 2',
        text: "Praise to the Lord, who o'er all things so wondrously reigneth,\nShelters thee under His wings, yea, so gently sustaineth!\nHast thou not seen how thy desires e'er have been\nGranted in what He ordaineth?",
      },
      {
        id: 'v3',
        label: 'Verse 3',
        text: 'Praise to the Lord, who doth prosper thy work and defend thee;\nSurely His goodness and mercy here daily attend thee.\nPonder anew what the Almighty can do,\nIf with His love He befriend thee.',
      },
    ],
    defaultArrangement: { sequence: ['v1', 'v2', 'v3'] },
    usageDates: [],
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
    usageDates: [],
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
    usageDates: [],
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
    usageDates: [],
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
    usageDates: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'song-sample-be-thou-my-vision',
    title: 'Be Thou My Vision',
    author: 'Irish traditional, tr. Mary Byrne',
    collections: [{ collectionId: 'collection-sample-hymnal-one', number: '62' }],
    tags: ['Hymn', 'Public Domain'],
    blocks: [
      {
        id: 'v1',
        label: 'Verse 1',
        text: 'Be Thou my vision, O Lord of my heart;\nNaught be all else to me, save that Thou art;\nThou my best thought, by day or by night,\nWaking or sleeping, Thy presence my light.',
      },
      {
        id: 'v2',
        label: 'Verse 2',
        text: 'Be Thou my wisdom, and Thou my true word;\nI ever with Thee and Thou with me, Lord;\nThou my great Father, I Thy true son;\nThou in me dwelling, and I with Thee one.',
      },
    ],
    defaultArrangement: { sequence: ['v1', 'v2'] },
    usageDates: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'song-sample-crown-him',
    title: 'Crown Him with Many Crowns',
    author: 'Matthew Bridges',
    collections: [{ collectionId: 'collection-sample-hymnal-one', number: '234' }],
    tags: ['Hymn', 'Public Domain'],
    blocks: [
      {
        id: 'v1',
        label: 'Verse 1',
        text: 'Crown Him with many crowns, the Lamb upon His throne;\nHark! how the heavenly anthem drowns all music but its own!\nAwake, my soul, and sing of Him who died for thee,\nAnd hail Him as thy matchless King through all eternity.',
      },
      {
        id: 'v2',
        label: 'Verse 2',
        text: 'Crown Him the Lord of love; behold His hands and side,\nRich wounds, yet visible above, in beauty glorified.\nAll hail, Redeemer, hail! For Thou hast died for me;\nThy praise shall never, never fail throughout eternity.',
      },
    ],
    defaultArrangement: { sequence: ['v1', 'v2'] },
    usageDates: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'song-sample-rock-of-ages',
    title: 'Rock of Ages',
    author: 'Augustus Toplady',
    collections: [{ collectionId: 'collection-sample-hymnal-two', number: '204' }],
    tags: ['Hymn', 'Public Domain'],
    blocks: [
      {
        id: 'v1',
        label: 'Verse 1',
        text: 'Rock of Ages, cleft for me,\nLet me hide myself in Thee;\nLet the water and the blood,\nFrom Thy wounded side which flowed,\nBe of sin the double cure,\nSave from wrath and make me pure.',
      },
      {
        id: 'v2',
        label: 'Verse 2',
        text: 'Nothing in my hand I bring,\nSimply to Thy cross I cling;\nNaked, come to Thee for dress,\nHelpless, look to Thee for grace;\nFoul, I to the fountain fly,\nWash me, Savior, or I die.',
      },
    ],
    defaultArrangement: { sequence: ['v1', 'v2'] },
    usageDates: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'song-sample-when-i-survey',
    title: 'When I Survey the Wondrous Cross',
    author: 'Isaac Watts',
    collections: [{ collectionId: 'collection-sample-hymnal-two', number: '177' }],
    tags: ['Hymn', 'Public Domain'],
    blocks: [
      {
        id: 'v1',
        label: 'Verse 1',
        text: 'When I survey the wondrous cross\nOn which the Prince of glory died,\nMy richest gain I count but loss,\nAnd pour contempt on all my pride.',
      },
      {
        id: 'v2',
        label: 'Verse 2',
        text: 'See, from His head, His hands, His feet,\nSorrow and love flow mingled down!\nDid e’er such love and sorrow meet,\nOr thorns compose so rich a crown?',
      },
    ],
    defaultArrangement: { sequence: ['v1', 'v2'] },
    usageDates: [],
    updatedAt: now,
    updatedByDevice: device,
  },
]

/** A directory big enough to look like a real church's rather than a demo's — which is what makes
 *  the alphabet quick-select rail, the first-name/last-name sort toggle, and assignment rotation
 *  demonstrate anything at all. Surnames deliberately span the alphabet; a handful carry preferred
 *  names, titles, or unavailability windows so those fields are visible somewhere.
 *
 *  Entirely fabricated. Real congregation names could never ship in a public repo, so unlike the
 *  songs this is a privacy constraint rather than a copyright one. */
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
  {
    id: 'person-sample-grace-bennett',
    firstName: 'Grace',
    lastName: 'Bennett',
    preferredRoleIds: ['role-sample-vocals'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-nathan-carter',
    firstName: 'Nathan',
    lastName: 'Carter',
    preferredRoleIds: ['role-sample-guitar', 'role-sample-vocals'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-wei-chen',
    firstName: 'Wei',
    lastName: 'Chen',
    preferredRoleIds: ['role-sample-sound-booth'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-elena-delgado',
    firstName: 'Elena',
    lastName: 'Delgado',
    preferredRoleIds: ['role-sample-nursery'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-robert-dunn',
    firstName: 'Robert',
    lastName: 'Dunn',
    preferredName: 'Bob',
    preferredRoleIds: ['role-sample-open', 'role-sample-close'],
    unavailableDateRanges: [{ start: daysFromNow(30), end: daysFromNow(44) }],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-hannah-ellis',
    firstName: 'Hannah',
    lastName: 'Ellis',
    preferredRoleIds: ['role-sample-kids-k2'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-michael-foster',
    firstName: 'Michael',
    lastName: 'Foster',
    preferredName: 'Mike',
    preferredRoleIds: ['role-sample-welcome-announcements'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-sofia-garcia',
    firstName: 'Sofia',
    lastName: 'Garcia',
    preferredRoleIds: ['role-sample-piano'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-peter-hale',
    firstName: 'Peter',
    lastName: 'Hale',
    title: 'Elder',
    preferredRoleIds: ['role-sample-prayer-praise', 'role-sample-sermon'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-olivia-hughes',
    firstName: 'Olivia',
    lastName: 'Hughes',
    preferredRoleIds: ['role-sample-greeter'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-andres-ibarra',
    firstName: 'Andres',
    lastName: 'Ibarra',
    preferredRoleIds: ['role-sample-drums'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-erik-jensen',
    firstName: 'Erik',
    lastName: 'Jensen',
    preferredRoleIds: ['role-sample-sound-booth'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-naomi-keller',
    firstName: 'Naomi',
    lastName: 'Keller',
    preferredRoleIds: ['role-sample-kids-34'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-grant-lawson',
    firstName: 'Grant',
    lastName: 'Lawson',
    preferredRoleIds: ['role-sample-scripture-reading'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-anna-lindgren',
    firstName: 'Anna',
    lastName: 'Lindgren',
    preferredRoleIds: ['role-sample-vocals'],
    unavailableDateRanges: [{ start: daysFromNow(60), end: daysFromNow(67) }],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-carlos-moreno',
    firstName: 'Carlos',
    lastName: 'Moreno',
    preferredRoleIds: ['role-sample-guitar'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-petra-novak',
    firstName: 'Petra',
    lastName: 'Novak',
    preferredRoleIds: ['role-sample-nursery', 'role-sample-greeter'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-maeve-obrien',
    firstName: 'Maeve',
    lastName: "O'Brien",
    preferredRoleIds: ['role-sample-vocals'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-miguel-ortiz',
    firstName: 'Miguel',
    lastName: 'Ortiz',
    preferredRoleIds: ['role-sample-close'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-ruth-palmer',
    firstName: 'Ruth',
    lastName: 'Palmer',
    preferredRoleIds: ['role-sample-kids-k2', 'role-sample-nursery'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-declan-quinn',
    firstName: 'Declan',
    lastName: 'Quinn',
    preferredRoleIds: ['role-sample-drums'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-isabel-ramirez',
    firstName: 'Isabel',
    lastName: 'Ramirez',
    preferredName: 'Izzy',
    preferredRoleIds: ['role-sample-piano', 'role-sample-vocals'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-javier-reyes',
    firstName: 'Javier',
    lastName: 'Reyes',
    preferredRoleIds: ['role-sample-open'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-caroline-sanders',
    firstName: 'Caroline',
    lastName: 'Sanders',
    preferredRoleIds: ['role-sample-welcome-announcements', 'role-sample-greeter'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-kenji-tanaka',
    firstName: 'Kenji',
    lastName: 'Tanaka',
    preferredRoleIds: ['role-sample-sound-booth'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-gabriela-torres',
    firstName: 'Gabriela',
    lastName: 'Torres',
    preferredName: 'Gabby',
    preferredRoleIds: ['role-sample-vocals'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-simon-underwood',
    firstName: 'Simon',
    lastName: 'Underwood',
    title: 'Elder',
    preferredRoleIds: ['role-sample-prayer-thanksgiving', 'role-sample-sermon'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-lucia-vargas',
    firstName: 'Lucia',
    lastName: 'Vargas',
    preferredRoleIds: ['role-sample-kids-34'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-fiona-walsh',
    firstName: 'Fiona',
    lastName: 'Walsh',
    preferredRoleIds: ['role-sample-greeter'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-theodore-whitfield',
    firstName: 'Theodore',
    lastName: 'Whitfield',
    preferredName: 'Ted',
    preferredRoleIds: ['role-sample-scripture-reading'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-amelia-yates',
    firstName: 'Amelia',
    lastName: 'Yates',
    preferredRoleIds: ['role-sample-piano'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'person-sample-adam-zimmerman',
    firstName: 'Adam',
    lastName: 'Zimmerman',
    preferredRoleIds: ['role-sample-close', 'role-sample-open'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
]

/** Both carry a real background from the bundled stock set (data/stockContent.ts), because a theme
 *  with only a font and a text colour cannot show what a theme is *for* — the background is the
 *  part people are actually choosing between. The ids are the stock media ids, which both the demo
 *  and the in-app "Add Stock Backgrounds" import create, so the reference resolves either way.
 *
 *  Each claims a different `useAsDefaultFor` target, so songs, scripture, sermons and text slides
 *  each render on their own background out of the box rather than sharing one — and a service can
 *  still override any individual item's theme when it wants something else. Between these two and
 *  the two stock themes, all four presentation targets are covered by four different images.
 *
 *  Deliberately leaves 'sermon' and 'text-slides' to the stock themes: two themes claiming the same
 *  content type is exactly the collision importStockBackgrounds goes out of its way to avoid, and
 *  its avoidance logic is what assigns the rest once these two have taken theirs.
 *
 *  Named for their image, matching how the stock themes are named ("Golden Cross", "Misty Dawn")
 *  — the card already shows what each one defaults for, so a name doing that job too would both
 *  duplicate it and go stale the moment someone reassigns the default. The earlier names were
 *  inconsistent with each other as well: "Classic Hymn" described content while "Modern Light"
 *  described styling.
 *
 *  Both carry light text with an outline, as anything over a photograph has to.
 *
 *  Backgrounds are matched to what each theme defaults for, since the image is doing the same job
 *  the words are: the open Bible sits behind scripture, the cross behind sermons (stock Golden
 *  Cross), a still lake behind text slides (stock Misty Dawn), and an open sunrise meadow behind
 *  songs. All four differ, so the Themes page shows real variety rather than one picture repeated. */
export const sampleThemes: Theme[] = [
  {
    id: 'theme-sample-misty-meadow',
    name: 'Misty Meadow',
    backgroundId: 'media-stock-misty-meadow-at-sunrise',
    font: 'Georgia',
    textColor: '#FFFFFF',
    outline: true,
    appliesTo: [],
    useAsDefaultFor: ['songs'],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'theme-sample-golden-sunrise',
    name: 'Golden Sunrise',
    backgroundId: 'media-stock-golden-sunrise-reading-vista',
    font: 'Montserrat',
    textColor: '#FFFFFF',
    outline: true,
    appliesTo: [],
    useAsDefaultFor: ['scripture'],
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

/** One example per templated service type — served from its own service-templates.json. Each
 *  mirrors a real printed bulletin's order (Welcome and Announcements through Closing Song),
 *  mixing bulletin-note items, content placeholders, a sermon placeholder, and role-only entries
 *  for roles with no line of their own in the order of service. 'Other' has no template — it's
 *  the free-form catch-all for anything that doesn't fit the two structured types. */
export const sampleServiceTemplates: ServiceTemplate[] = [
  {
    id: 'template-sample-sunday-worship',
    name: 'Sunday Worship',
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
    id: 'template-sample-sunday-communion',
    name: 'Sunday Communion',
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

/** One Sunday's worth of choices — everything that differs week to week. The order of worship
 *  itself comes from the template and is the same every week, which is the point of having one. */
interface SundayPlan {
  date: Date
  /** Songs in the order the template's song slots appear. Worship needs six, communion seven —
   *  the extra two being the one sung before the table and the one during the serving of the cup. */
  songIds: string[]
  callToWorship: string
  reading: string
  sermonTitle: string
  sermonPassage: string
  assignments: RoleAssignment[]
}

/** Builds a service following one of the two real templates exactly — the same order, labels and
 *  roles a printed bulletin would show.
 *
 *  Written as a builder rather than as literal service objects because the whole point is that
 *  every Sunday shares one structure: hand-writing each one invites them to drift apart, and a
 *  demo whose services do not match its own templates teaches the wrong thing about how templates
 *  work. Only the plan above varies.
 *
 *  Note there are no `role-only` items here even though both templates carry several. Those exist
 *  to put roles on the roster without giving them a line in the order of worship, so they surface
 *  as assignments rather than as service items. */
function sundayService(id: string, plan: SundayPlan, communion: boolean): Service {
  let songSlot = 0
  const song = (itemId: string, bulletinLabel?: string, bulletinNote?: string): ServiceItem => {
    const songId = plan.songIds[songSlot++ % plan.songIds.length]!
    const source = sampleSongs.find((candidate) => candidate.id === songId)
    return {
      id: itemId,
      type: 'song',
      songId,
      arrangement: { sequence: source?.defaultArrangement.sequence ?? [] },
      ...(bulletinLabel ? { bulletinLabel } : {}),
      ...(bulletinNote ? { bulletinNote } : {}),
    }
  }

  // The pre-service loop, running before anything else starts. Deliberately carries no
  // bulletinLabel: orderOfWorship.ts filters out a slide item without one, which is exactly right
  // — this plays to an empty room and has no business in the printed order of worship.
  const preService: ServiceItem = {
    id: 'item-pre-service',
    type: 'slide-ref',
    slideId: 'slide-sample-pre-service',
  }

  const welcome: ServiceItem = {
    id: 'item-welcome',
    type: 'bulletin-note',
    bulletinLabel: 'Welcome and Announcements',
    roleId: 'role-sample-welcome-announcements',
  }
  const silentPrep: ServiceItem = {
    id: 'item-silent-prep',
    type: 'bulletin-note',
    bulletinLabel: 'Silent Preparation',
    bulletinNote: '(please spend the next few moments preparing your heart for corporate worship)',
  }
  const callToWorship: ServiceItem = {
    id: 'item-call-to-worship',
    type: 'scripture',
    reference: plan.callToWorship,
    translation: 'KJV',
    displayMode: 'full',
    bulletinLabel: 'Scriptural Call to Worship',
  }
  const prayerPraise: ServiceItem = {
    id: 'item-prayer-praise',
    type: 'bulletin-note',
    bulletinLabel: 'Prayer of Praise and Confession',
    roleId: 'role-sample-prayer-praise',
  }
  const reading: ServiceItem = {
    id: 'item-reading',
    type: 'scripture',
    reference: plan.reading,
    translation: 'KJV',
    displayMode: 'full',
    bulletinLabel: 'Scripture Reading',
    roleId: 'role-sample-scripture-reading',
  }
  const prayerThanksgiving: ServiceItem = {
    id: 'item-prayer-thanksgiving',
    type: 'bulletin-note',
    bulletinLabel: 'Prayer of Thanksgiving and Petition',
    roleId: 'role-sample-prayer-thanksgiving',
  }
  const sermon: ServiceItem = {
    id: 'item-sermon',
    type: 'sermon',
    title: plan.sermonTitle,
    passages: [
      {
        id: 'passage-sermon',
        reference: plan.sermonPassage,
        translation: 'KJV',
        displayMode: 'full',
      },
    ],
    mainPassageId: 'passage-sermon',
    outline: [],
    roleId: 'role-sample-sermon',
    bulletinLabel: 'Worship Through the Word',
  }
  const silentReflection: ServiceItem = {
    id: 'item-silent-reflection',
    type: 'bulletin-note',
    bulletinLabel: 'Silent Reflection',
    bulletinNote: "(please spend the next few moments silently reflecting on today's service)",
  }

  const items: ServiceItem[] = communion
    ? [
        preService,
        welcome,
        silentPrep,
        callToWorship,
        song('item-song-1'),
        prayerPraise,
        song('item-song-2'),
        song('item-song-3'),
        reading,
        prayerThanksgiving,
        song('item-offering', 'Tithes and Offerings'),
        sermon,
        song('item-song-4'),
        song(
          'item-lords-supper',
          "The Lord's Supper",
          '(we will sing during the serving of the cup)',
        ),
        song('item-closing', 'Closing Song'),
      ]
    : [
        preService,
        welcome,
        silentPrep,
        callToWorship,
        song('item-song-1'),
        song('item-song-2'),
        prayerPraise,
        song('item-song-3'),
        song('item-song-4'),
        reading,
        prayerThanksgiving,
        song('item-offering', 'Tithes and Offerings'),
        sermon,
        silentReflection,
        song('item-closing', 'Closing Song'),
      ]

  return {
    id,
    date: toIso(plan.date),
    time: '10:30',
    serviceTypeId: communion ? 'type-sample-sunday-communion' : 'type-sample-sunday-worship',
    serviceTemplateId: communion
      ? 'template-sample-sunday-communion'
      : 'template-sample-sunday-worship',
    items,
    assignments: plan.assignments,
    updatedAt: now,
    updatedByDevice: device,
  }
}

/** Communion is the first Sunday of the month; every other Sunday uses the ordinary order. */
function isFirstSundayOfMonth(date: Date): boolean {
  return date.getDate() <= 7
}

/** A full roster for a Sunday, rotating through the directory so no two consecutive weeks look
 *  identical — which is what makes the Assignments view and the bulletin's serving schedule show
 *  something worth looking at. `week` simply indexes into each role's own list of volunteers. */
function rotatingRoster(week: number): RoleAssignment[] {
  const pick = (people: string[]) => people[week % people.length]!
  return [
    { roleId: 'role-sample-sermon', personId: pick(PREACHERS), tentative: false },
    { roleId: 'role-sample-piano', personId: pick(PIANISTS), tentative: false },
    { roleId: 'role-sample-guitar', personId: pick(GUITARISTS), tentative: false },
    { roleId: 'role-sample-drums', personId: pick(DRUMMERS), tentative: false },
    { roleId: 'role-sample-vocals', personId: pick(VOCALISTS), tentative: false },
    { roleId: 'role-sample-sound-booth', personId: pick(SOUND), tentative: false },
    { roleId: 'role-sample-scripture-reading', personId: pick(READERS), tentative: false },
    { roleId: 'role-sample-welcome-announcements', personId: pick(HOSTS), tentative: false },
    { roleId: 'role-sample-greeter', personId: pick(GREETERS), tentative: false },
    { roleId: 'role-sample-nursery', personId: pick(NURSERY), tentative: false },
    { roleId: 'role-sample-open', personId: BUILDING[week % BUILDING.length]!, tentative: false },
    // Offset by one so opening and closing never land on the same person in the same week.
    {
      roleId: 'role-sample-close',
      personId: BUILDING[(week + 1) % BUILDING.length]!,
      tentative: false,
    },
  ]
}

const PREACHERS = [
  'person-sample-james-smith',
  'person-sample-james-smith',
  'person-sample-peter-hale',
  'person-sample-james-smith',
  'person-sample-simon-underwood',
]
const PIANISTS = [
  'person-sample-marcus-johnson',
  'person-sample-sofia-garcia',
  'person-sample-amelia-yates',
  'person-sample-isabel-ramirez',
]
const GUITARISTS = [
  'person-sample-priya-patel',
  'person-sample-nathan-carter',
  'person-sample-carlos-moreno',
]
const DRUMMERS = [
  'person-sample-daniel-kim',
  'person-sample-andres-ibarra',
  'person-sample-declan-quinn',
]
const VOCALISTS = [
  'person-sample-sarah-mitchell',
  'person-sample-grace-bennett',
  'person-sample-maeve-obrien',
  'person-sample-gabriela-torres',
  'person-sample-anna-lindgren',
]
const SOUND = [
  'person-sample-rachel-nguyen',
  'person-sample-wei-chen',
  'person-sample-erik-jensen',
  'person-sample-kenji-tanaka',
]
const READERS = [
  'person-sample-tom-alvarez',
  'person-sample-grant-lawson',
  'person-sample-theodore-whitfield',
]
const HOSTS = ['person-sample-michael-foster', 'person-sample-caroline-sanders']
const GREETERS = [
  'person-sample-linda-brooks',
  'person-sample-olivia-hughes',
  'person-sample-fiona-walsh',
  'person-sample-petra-novak',
]
// Deliberately no overlap between any two lists here: a person in two of them would eventually be
// rostered twice in one week, which sampleData.spec.ts rightly treats as an accident rather than
// the one conflict the upcoming service stages on purpose.
const NURSERY = ['person-sample-elena-delgado', 'person-sample-ruth-palmer']
const BUILDING = [
  'person-sample-robert-dunn',
  'person-sample-javier-reyes',
  'person-sample-miguel-ortiz',
  'person-sample-adam-zimmerman',
]

/** Enough past Sundays for "last used" and "used N times this year" to mean something. Four
 *  services clustered around today left every usage report empty, which made a real feature look
 *  broken in every screenshot. */
const PAST_SUNDAYS = 12

const SONG_POOL = [
  'song-sample-amazing-grace',
  'song-sample-holy-holy-holy',
  'song-sample-it-is-well',
  'song-sample-praise-to-the-lord',
  'song-sample-blessed-assurance',
  'song-sample-come-thou-fount',
  'song-sample-how-firm-a-foundation',
  'song-sample-what-a-friend',
  'song-sample-be-thou-my-vision',
  'song-sample-crown-him',
  'song-sample-rock-of-ages',
  'song-sample-when-i-survey',
]

/** Songs for `week`, walking the pool at a stride coprime with its length so the selection
 *  genuinely rotates instead of repeating the same handful — some hymns end up used several times
 *  across the year and others once, which is what a usage report should show. Seven are returned
 *  because a communion Sunday has that many song slots; an ordinary Sunday takes the first six. */
function songsForWeek(week: number): string[] {
  const stride = 5
  return Array.from(
    { length: 7 },
    (_, slot) => SONG_POOL[(week * stride + slot * 2) % SONG_POOL.length]!,
  )
}

const SERMON_SERIES = [
  { title: 'The God Who Speaks', passage: 'Hebrews 1:1-4', call: 'Psalm 95:1-7' },
  { title: 'Walking in Faith', passage: 'Hebrews 11:1-6', call: 'Psalm 100' },
  { title: 'The Good Shepherd', passage: 'Psalm 23', call: 'Psalm 34:1-8' },
  { title: 'Grace and Faith', passage: 'Romans 8:28-39', call: 'Isaiah 55:1-3' },
  { title: 'A Living Hope', passage: '1 Peter 1:3-9', call: 'Psalm 145:1-7' },
  { title: 'The Cost of Following', passage: 'Luke 9:57-62', call: 'Psalm 27:1-6' },
]

/** Builds the sample services fresh against whatever "today" is when called — this is what makes
 *  re-running "Load Sample Data" refresh the demo to always-current dates rather than drifting
 *  into the past.
 *
 *  The shape on purpose: a year-ish of completed Sundays behind today so usage reports and the
 *  serving schedule have history, this week and next fully planned, a midweek study that uses none
 *  of the Sunday structure, and one further-out Sunday still mostly empty. */
export function buildSampleServices(referenceDate = new Date()): Service[] {
  const past = lastSunday(new Date(referenceDate.getTime() - 24 * 60 * 60 * 1000))
  const soon = nthSundayAfter(referenceDate, 1)
  const twoWeeks = nthSundayAfter(referenceDate, 2)
  const wednesday = nextWednesday(referenceDate)
  const future = nthSundayAfter(referenceDate, 3)

  const services: Service[] = []

  // Completed Sundays, oldest first. Week 0 is the furthest back.
  for (let index = PAST_SUNDAYS; index >= 1; index--) {
    const date = new Date(past)
    date.setDate(date.getDate() - 7 * index)
    const sermon = SERMON_SERIES[(PAST_SUNDAYS - index) % SERMON_SERIES.length]!
    services.push(
      sundayService(
        `service-sample-past-${index}`,
        {
          date,
          songIds: songsForWeek(PAST_SUNDAYS - index),
          callToWorship: sermon.call,
          reading: sermon.passage,
          sermonTitle: sermon.title,
          sermonPassage: sermon.passage,
          assignments: rotatingRoster(PAST_SUNDAYS - index),
        },
        isFirstSundayOfMonth(date),
      ),
    )
  }

  // Last Sunday: the most recent completed service.
  services.push(
    sundayService(
      'service-sample-past-sunday',
      {
        date: past,
        songIds: songsForWeek(PAST_SUNDAYS),
        callToWorship: 'Psalm 95:1-7',
        reading: 'Hebrews 11:1-6',
        sermonTitle: 'Walking in Faith',
        sermonPassage: 'Hebrews 11:1-6',
        assignments: rotatingRoster(PAST_SUNDAYS),
      },
      isFirstSundayOfMonth(past),
    ),
  )

  // This coming Sunday, fully planned. Marcus is deliberately double-booked (Piano AND Open) and
  // one guitarist is tentative — between them these exercise the roster's same-week-two-roles
  // conflict detection (rosterConflicts.ts) and the tentative-assignment display.
  const upcoming = sundayService(
    'service-sample-upcoming-sunday',
    {
      date: soon,
      songIds: songsForWeek(PAST_SUNDAYS + 1),
      callToWorship: 'Psalm 100',
      reading: 'Psalm 23',
      sermonTitle: 'The Good Shepherd',
      sermonPassage: 'Psalm 23',
      assignments: [
        ...rotatingRoster(PAST_SUNDAYS + 1).filter(
          (assignment) => assignment.roleId !== 'role-sample-open',
        ),
        { roleId: 'role-sample-open', personId: 'person-sample-marcus-johnson', tentative: false },
        { roleId: 'role-sample-piano', personId: 'person-sample-marcus-johnson', tentative: false },
        { roleId: 'role-sample-guitar', personId: 'person-sample-priya-patel', tentative: true },
      ].filter(
        (assignment, index, all) =>
          // Keep the last entry for any role written twice above, so the overrides win.
          all.findIndex(
            (other) => other.roleId === assignment.roleId && other.personId === assignment.personId,
          ) === index,
      ),
    },
    isFirstSundayOfMonth(soon),
  )
  // An announcement slide is service-specific rather than part of the template — inserted after
  // the welcome (index 0 is the pre-service loop), which is where one would really go.
  upcoming.items.splice(2, 0, {
    id: 'item-announcement-slides',
    type: 'text-slide',
    slides: [
      {
        id: 's1',
        label: 'Announcement',
        text: 'Vacation Bible School registration is now open — sign up at the welcome desk.',
      },
    ],
  })
  services.push(upcoming)

  // Two Sundays out: planned, but visibly less settled than this week — the preacher and music are
  // set while several supporting roles are still tentative or unfilled. Most services live in this
  // state for most of their life, so the demo should show more than one of them.
  services.push(
    sundayService(
      'service-sample-two-weeks',
      {
        date: twoWeeks,
        songIds: songsForWeek(PAST_SUNDAYS + 2),
        callToWorship: 'Isaiah 55:1-3',
        reading: '1 Peter 1:3-9',
        sermonTitle: 'A Living Hope',
        sermonPassage: '1 Peter 1:3-9',
        assignments: rotatingRoster(PAST_SUNDAYS + 2)
          .filter(
            (assignment) =>
              !['role-sample-greeter', 'role-sample-nursery', 'role-sample-close'].includes(
                assignment.roleId,
              ),
          )
          .map((assignment) =>
            assignment.roleId === 'role-sample-drums'
              ? { ...assignment, tentative: true }
              : assignment,
          ),
      },
      isFirstSundayOfMonth(twoWeeks),
    ),
  )

  services.push({
    // Deliberately does not use a template: 'Other' is the free-form catch-all, and a midweek
    // study genuinely has none of Sunday's structure. Shows what an untemplated service looks like.
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
        // The one reference-only item in the sample data, so the demo can actually show the
        // wayfinding display (the reference large, with the neighbouring books fading away either
        // side) rather than leaving a whole presentation mode invisible. Realistic here
        // specifically: a midweek study is where a group reads along in their own Bibles, which is
        // the case reference-only exists for. Sunday's readings stay full text.
        id: 'item-2',
        type: 'scripture',
        reference: 'Romans 8:28-39',
        translation: 'KJV',
        displayMode: 'reference-only',
      },
      {
        id: 'item-sermon',
        type: 'sermon',
        title: 'Grace and Faith',
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
      { roleId: 'role-sample-sermon', personId: 'person-sample-peter-hale', tentative: false },
      {
        roleId: 'role-sample-sound-booth',
        personId: 'person-sample-wei-chen',
        tentative: false,
      },
    ],
    updatedAt: now,
    updatedByDevice: device,
  })

  services.push({
    // Deliberately sparse — the template has been applied, so the order of worship is there, but
    // the songs, preacher and most roles are still undecided. This is what a service actually looks
    // like mid-planning, and it is the state most services spend most of their life in.
    id: 'service-sample-future-sunday',
    date: toIso(future),
    time: '10:30',
    serviceTypeId: 'type-sample-sunday-worship',
    serviceTemplateId: 'template-sample-sunday-worship',
    items: [
      { id: 'item-pre-service', type: 'slide-ref', slideId: 'slide-sample-pre-service' },
      {
        id: 'item-welcome',
        type: 'bulletin-note',
        bulletinLabel: 'Welcome and Announcements',
        roleId: 'role-sample-welcome-announcements',
      },
      {
        id: 'item-silent-prep',
        type: 'bulletin-note',
        bulletinLabel: 'Silent Preparation',
        bulletinNote:
          '(please spend the next few moments preparing your heart for corporate worship)',
      },
      { id: 'item-call-to-worship', type: 'placeholder', label: 'Scriptural Call to Worship' },
      {
        id: 'item-song-1',
        type: 'song',
        songId: 'song-sample-what-a-friend',
        arrangement: { sequence: ['v1', 'v2'] },
      },
      { id: 'item-song-2', type: 'placeholder', label: 'Song', suggestedTab: 'songs' },
      {
        id: 'item-prayer-praise',
        type: 'bulletin-note',
        bulletinLabel: 'Prayer of Praise and Confession',
        roleId: 'role-sample-prayer-praise',
      },
      { id: 'item-sermon', type: 'placeholder', label: 'Worship Through the Word' },
      { id: 'item-closing', type: 'placeholder', label: 'Closing Song', suggestedTab: 'songs' },
    ],
    assignments: [
      { roleId: 'role-sample-vocals', personId: 'person-sample-grace-bennett', tentative: true },
    ],
    updatedAt: now,
    updatedByDevice: device,
  })

  return services
}

/** Derives each song's `usageDates` from an already-built `services` array (e.g.
 *  `buildSampleServices()`'s own output) rather than hand-computing dates that would have to be
 *  kept in sync with that function's "relative to today" logic by hand. `sampleSongs` itself
 *  keeps its `usageDates` empty — the in-app "Load Sample Data" flow (LibrarySyncSection.vue)
 *  saves songs before services, so the normal incremental usage-update path (services.save's
 *  own port implementation) fills them in for that flow already; this helper exists for the
 *  public demo build's fixtures.ts, which seeds each collection directly rather than through
 *  that save flow, and would otherwise start with every song showing "Not yet used" despite the
 *  seeded services obviously referencing them. */
export function withSampleUsageDates(songs: Song[], services: Service[]): Song[] {
  const entriesBySongId = new Map<string, Song['usageDates']>()
  for (const service of services) {
    for (const songId of songIdsInService(service)) {
      const entries = entriesBySongId.get(songId) ?? []
      entries.push({ serviceId: service.id, date: service.date })
      entriesBySongId.set(songId, entries)
    }
  }
  return songs.map((song) => ({
    ...song,
    usageDates: entriesBySongId.get(song.id) ?? song.usageDates,
  }))
}
