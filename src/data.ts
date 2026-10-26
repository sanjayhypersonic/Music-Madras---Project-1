import { Video, Playlist, CommunityPost } from './types';

export const CHANNEL_INFO = {
  name: 'Music Madras',
  handle: '@MusicMadras',
  url: 'https://www.youtube.com/@MusicMadras',
  description: 'Music Madras: A Pure Live Experience - Digital Archive',
  detailedDescription: 'Welcome to Music Madras, your front-row seat to the authentic sound of Western and Indian classical concerts in Chennai. This includes Church Music. In an era of over-processed live recordings, we believe something vital is lost when the "concert hall sound" is sanitized by extreme post-production. Our mission is to bridge that gap. We celebrate the "perfectly imperfect" nature of live music, capturing the blend and balance intended for the live audience.',
  subscribers: '874',
  videoCount: '181',
  totalViews: '227K',
  location: 'Chennai, Tamil Nadu, India',
  turnaroundTime: '2-3 Business Days',
  qualitySpec: {
    video: '4K Ultra HD (Flagship-grade mobile single/multi-cam 4K capture, completely silent & non-distracting)',
    audio: 'Studio-quality condenser and ribbon microphones, high-gain pre-amps, and high-resolution DACs',
    production: 'Minimal linear post-production to preserve natural concert hall resonance and instrument blending'
  }
};

export const VIDEOS_DATA: Video[] = [
  {
    id: 'vid-pop-1',
    youtubeId: 'zEQmnmwr5UE',
    title: "டிங்கிரி டிங்காலே | Dingiri Dingalae | Classic Tamil Song | The Chennai Chorale & SASO | Music Madras",
    artist: "The Chennai Chorale & SASO",
    category: 'Concert',
    duration: '03:47',
    views: '38K',
    viewsCount: 38000,
    publishedAt: '10 months ago',
    description: "A spectacular performance of 'Dingiri Dingalae' by The South Asian Symphony Orchestra (SASO) and The Chennai Chorale, conducted by Alvin Arumugam. Arranged by Augustine Paul.",
    likesCount: 450,
    thumbnailUrl: "https://i.ytimg.com/vi/zEQmnmwr5UE/hqdefault.jpg"
  },
  {
    id: 'vid-pop-2',
    youtubeId: 'Mx0vgJb7LOc',
    title: "ஆபிரகாமை ஆசீர்வதித்த | Aabiragamai Aasirvathitha | Tamil Christian Wedding Song | Music Madras",
    artist: "Jeremiah Christopher & Music Madras",
    category: 'Vocal',
    duration: '03:15',
    views: '34K',
    viewsCount: 34000,
    publishedAt: '10 months ago',
    description: "Traditional Tamil Christian Wedding Song 'ஆபிரகாமை ஆசீர்வதித்த' (Aabiragamai Aasirvathitha) captured live with studio-quality audio, preserving pure natural acoustics.",
    likesCount: 380,
    thumbnailUrl: "https://i.ytimg.com/vi/Mx0vgJb7LOc/hqdefault.jpg"
  },
  {
    id: 'vid-pop-3',
    youtubeId: 'd2FcoRBYgNs',
    title: "மங்களம் செழிக்க கிருபை | Mangalam Sezhikka | Tamil Christian Wedding Song | Music Madras | Harmony",
    artist: "Jeremiah Christopher & Harmony Ensemble",
    category: 'Vocal',
    duration: '03:22',
    views: '21K',
    viewsCount: 21000,
    publishedAt: '10 months ago',
    description: "Exquisite multi-part vocal harmony performance of 'மங்களம் செழிக்க கிருபை' (Mangalam Sezhikka), Tamil Christian Wedding Song recorded live by Music Madras.",
    likesCount: 290,
    thumbnailUrl: "https://i.ytimg.com/vi/d2FcoRBYgNs/hqdefault.jpg"
  },
  {
    id: 'vid-pop-4',
    youtubeId: 'RqaX9KA3hQw',
    title: "Psalm 128 | Blessed Are All They That Fear the Lord | Christian Wedding Song | Music Madras | Indian",
    artist: "Wedding Choir",
    category: 'Choral',
    duration: '03:40',
    views: '9.2K',
    viewsCount: 9200,
    publishedAt: '10 months ago',
    description: "Choral rendering of Psalm 128 (Blessed Are All They That Fear the Lord), Christian Wedding Song captured with matched stereo condensers.",
    likesCount: 210,
    thumbnailUrl: "https://i.ytimg.com/vi/RqaX9KA3hQw/hqdefault.jpg"
  },
  {
    id: 'vid-pop-5',
    youtubeId: 'wpjNVCpQPcs',
    title: "O Perfect Love | SATB with Descant | Wedding Hymn | Pipe Organ | Music Madras",
    artist: "SATB with Descant & Pipe Organ",
    category: 'Organ',
    duration: '03:05',
    views: '8.9K',
    viewsCount: 8900,
    publishedAt: '1 month ago',
    description: "Beloved wedding hymn 'O Perfect Love' performed SATB with descant and majestic pipe organ accompaniment, recorded live in historic church acoustics.",
    likesCount: 195,
    thumbnailUrl: "https://i.ytimg.com/vi/wpjNVCpQPcs/hqdefault.jpg"
  },
  {
    id: 'vid-pop-6',
    youtubeId: '4q_xbkVrJuk',
    title: "Sevenfold Amen | John Stainer | SATB A Cappella | Choral Music | Music Madras",
    artist: "SATB A Cappella Ensemble",
    category: 'Choral',
    duration: '02:05',
    views: '3.8K',
    viewsCount: 3800,
    publishedAt: '2 weeks ago',
    description: "John Stainer's beloved Sevenfold Amen performed SATB A Cappella, demonstrating the pristine microphony and spatial acoustic capture of Music Madras.",
    likesCount: 175,
    thumbnailUrl: "https://i.ytimg.com/vi/4q_xbkVrJuk/hqdefault.jpg"
  },
  {
    id: 'vid-pop-7',
    youtubeId: 'rUrS7Pb2W90',
    title: "The Voice That Breathed O'er Eden | SATB with Descant | Pipe Organ | Wedding Hymn | Music Madras",
    artist: "SATB with Descant & Pipe Organ",
    category: 'Organ',
    duration: '02:29',
    views: '3.6K',
    viewsCount: 3600,
    publishedAt: '1 month ago',
    description: "Timeless wedding hymn 'The Voice That Breathed O'er Eden' performed live with SATB descant and historic pipe organ.",
    likesCount: 160,
    thumbnailUrl: "https://i.ytimg.com/vi/rUrS7Pb2W90/hqdefault.jpg"
  },
  {
    id: 'vid-pop-8',
    youtubeId: '27sD8ZEGnP4',
    title: "Mozart: Coronation Mass in C Major – Gloria | The Chennai Chorale | Augustine Paul | Music Madras",
    artist: "The Chennai Chorale & Augustine Paul",
    category: 'Choral',
    duration: '04:11',
    views: '3.5K',
    viewsCount: 3500,
    publishedAt: '2 weeks ago',
    description: "Exuberant Gloria from Mozart's Coronation Mass in C Major. Live acoustic fidelity preserving the natural blend of chorus and chamber accompaniment.",
    likesCount: 165,
    thumbnailUrl: "https://i.ytimg.com/vi/27sD8ZEGnP4/hqdefault.jpg"
  },
  {
    id: 'vid-pop-9',
    youtubeId: 'qSanTFzrvpE',
    title: "Isravele Kartharai Nambu | The Gospel Chords | Samuel Joseph | Music Madras | SATB",
    artist: "The Gospel Chords & Samuel Joseph",
    category: 'Choral',
    duration: '03:16',
    views: '3.3K',
    viewsCount: 3300,
    publishedAt: '2 months ago',
    description: "Sacred Tamil SATB hymn 'Isravele Kartharai Nambu' performed by The Gospel Chords conducted by Samuel Joseph.",
    likesCount: 145,
    thumbnailUrl: "https://i.ytimg.com/vi/qSanTFzrvpE/hqdefault.jpg"
  },
  {
    id: 'vid-pop-10',
    youtubeId: '3Xfuow_RTZk',
    title: "Praise the Lord of Love | Mary McDonald | Augustine Paul | Jeremiah Christopher",
    artist: "Augustine Paul & Jeremiah Christopher",
    category: 'Choral',
    duration: '04:36',
    views: '3.1K',
    viewsCount: 3100,
    publishedAt: '1 month ago',
    description: "Mary McDonald's inspiring choral anthem 'Praise the Lord of Love' performed live under Augustine Paul with organ by Jeremiah Christopher.",
    likesCount: 135,
    thumbnailUrl: "https://i.ytimg.com/vi/3Xfuow_RTZk/hqdefault.jpg"
  },
  {
    id: 'vid-pop-11',
    youtubeId: 'R-m1jVD_4zo',
    title: "தேவசேனை வானமீது | Deva Senai Vaanameedhu | Tamil Christian Song | ECI Hope Cathedral Choir | Music Madras",
    artist: "ECI Hope Cathedral Choir",
    category: 'Vocal',
    duration: '03:16',
    views: '2.3K',
    viewsCount: 2300,
    publishedAt: '3 weeks ago',
    description: "Traditional Tamil Christian choral anthem 'Deva Senai Vaanameedhu' performed live with full choir and congregation at ECI Hope Cathedral.",
    likesCount: 195,
    thumbnailUrl: "https://i.ytimg.com/vi/R-m1jVD_4zo/hqdefault.jpg"
  },
  {
    id: 'vid-pop-12',
    youtubeId: 'Cch3sMiHWqY',
    title: "Mendelssohn's Wedding March | A Midsummer Night's Dream, Op. 61 No 9 | Arul Siromoney | Music Madras",
    artist: "Arul Siromoney (Pipe Organ)",
    category: 'Organ',
    duration: '04:17',
    views: '2.2K',
    viewsCount: 2200,
    publishedAt: '3 weeks ago',
    description: "Felix Mendelssohn's iconic Wedding March played on the historic pipe organ by Arul Siromoney. Full low-end pedal capture and pipe brilliance.",
    likesCount: 310,
    thumbnailUrl: "https://i.ytimg.com/vi/Cch3sMiHWqY/hqdefault.jpg"
  },
  {
    id: 'vid-pop-13',
    youtubeId: 'cqbpqlaAgdo',
    title: "The Lord Bless You and Keep You | John Rutter | Christian Wedding Song | Music Madras | Andrews Kirk",
    artist: "Wedding Choir",
    category: 'Choral',
    duration: '02:43',
    views: '2.0K',
    viewsCount: 2000,
    publishedAt: '1 month ago',
    description: "John Rutter's timeless benediction 'The Lord Bless You and Keep You' captured live in the glorious acoustic of St. Andrew's Church.",
    likesCount: 120,
    thumbnailUrl: "https://i.ytimg.com/vi/cqbpqlaAgdo/hqdefault.jpg"
  },
  {
    id: 'vid-pop-14',
    youtubeId: 'PpuO1CxaN5A',
    title: "Ambara Umbara I Tamil Christian Song I Tamil Christmas Traditional Song",
    artist: "Bishop Heber Chapel Choir",
    category: 'Vocal',
    duration: '03:56',
    views: '1.9K',
    viewsCount: 1900,
    publishedAt: '9 months ago',
    description: "A beautiful, authentic live choral performance of the traditional Tamil Christmas song 'Ambara Umbara' by the Bishop Heber Chapel Choir.",
    likesCount: 98,
    thumbnailUrl: "https://i.ytimg.com/vi/PpuO1CxaN5A/hqdefault.jpg"
  },
  {
    id: 'vid-pop-15',
    youtubeId: 'vgh1AU_pg3w',
    title: "எந்தன் ஜெபவேளை | Enthan Jebavelai | Tamil Christian Prayer Song | CSI Church of New Life in Jesus",
    artist: "CSI Church of New Life in Jesus",
    category: 'Vocal',
    duration: '03:51',
    views: '1.3K',
    viewsCount: 1300,
    publishedAt: '2 days ago',
    description: "An authentic, pristine live recording of 'எந்தன் ஜெபவேளை' (Enthan Jebavelai), Tamil Christian Prayer Song captured live at CSI Church of New Life in Jesus by Music Madras.",
    likesCount: 168,
    thumbnailUrl: "https://i.ytimg.com/vi/vgh1AU_pg3w/hqdefault.jpg"
  },
  {
    id: 'vid-pop-16',
    youtubeId: 'NywlHEmY8YY',
    title: "Father Make Us One | EMC Alumni Choir | Emmanuel Methodist Church | Homecoming Concert 2026",
    artist: "EMC Alumni Choir",
    category: 'Choral',
    duration: '01:35',
    views: '1.2K',
    viewsCount: 1200,
    publishedAt: '8 months ago',
    description: "The moving anthem 'Father Make Us One' performed live by the EMC Alumni Choir at Emmanuel Methodist Church.",
    likesCount: 85,
    thumbnailUrl: "https://i.ytimg.com/vi/NywlHEmY8YY/hqdefault.jpg"
  },
  {
    id: 'vid-pop-17',
    youtubeId: 'SnNhzusCr8w',
    title: "Chinna Maamiye Un Chinna Magal Engae | Tamil Baila Song | SATB | Throwback 2019",
    artist: "SATB Choral Ensemble",
    category: 'Concert',
    duration: '03:23',
    views: '1.2K',
    viewsCount: 1200,
    publishedAt: '9 months ago',
    description: "Lively performance of Tamil Baila classic 'Chinna Maamiye Un Chinna Magal Engae' in 4-part SATB choral voicing.",
    likesCount: 110,
    thumbnailUrl: "https://i.ytimg.com/vi/SnNhzusCr8w/hqdefault.jpg"
  },
  {
    id: 'vid-pop-18',
    youtubeId: '4pAoEsZL9PQ',
    title: "Mozart: Coronation Mass in C Major – Agnus Dei | The Chennai Chorale | Augustine Paul",
    artist: "The Chennai Chorale & Augustine Paul",
    category: 'Choral',
    duration: '06:25',
    views: '1.1K',
    viewsCount: 1100,
    publishedAt: '2 weeks ago',
    description: "Sublime Agnus Dei soloist and choral progression from Mozart's Coronation Mass in C Major, recorded live with zero artificial processing.",
    likesCount: 210,
    thumbnailUrl: "https://i.ytimg.com/vi/4pAoEsZL9PQ/hqdefault.jpg"
  },
  {
    id: 'vid-pop-19',
    youtubeId: '1m8t8IwkDHs',
    title: "Chinnachiru Suthane | Carols by Candlelight 2025 | WCC Choir | Christmas Carols 2025",
    artist: "WCC Choir",
    category: 'Choral',
    duration: '04:29',
    views: '1.0K',
    viewsCount: 1000,
    publishedAt: '10 months ago',
    description: "The elegant Tamil Christmas Carol 'Chinnachiru Suthane' performed live during the annual Carols by Candlelight service.",
    likesCount: 140,
    thumbnailUrl: "https://i.ytimg.com/vi/1m8t8IwkDHs/hqdefault.jpg"
  },
  {
    id: 'vid-pop-20',
    youtubeId: 'w7LPiA_e1lk',
    title: "ஆ கர்த்தாவே தாழ்மையாக | Aa Karthaavae | The Gospel Chords | TELC Arulnathar Church | Samuel J",
    artist: "The Gospel Chords & Samuel Joseph",
    category: 'Vocal',
    duration: '02:04',
    views: '935',
    viewsCount: 935,
    publishedAt: '3 months ago',
    description: "Devotional hymn 'Aa Karthaavae' rendered live with pure acoustic resonance at TELC Arulnathar Church.",
    likesCount: 75,
    thumbnailUrl: "https://i.ytimg.com/vi/w7LPiA_e1lk/hqdefault.jpg"
  },
  {
    id: 'vid-pop-21',
    youtubeId: 'pAB_ysp_6mU',
    title: "It Is Well With My Soul | Live Church Choir | Christian Hymn | Arulnathar Chennai | Music Madras",
    artist: "TELC Arulnathar Choir",
    category: 'Choral',
    duration: '02:32',
    views: '931',
    viewsCount: 931,
    publishedAt: '1 month ago',
    description: "Horatio Spafford's beloved hymn 'It Is Well With My Soul' sung with heartfelt emotion by the choir.",
    likesCount: 88,
    thumbnailUrl: "https://i.ytimg.com/vi/pAB_ysp_6mU/hqdefault.jpg"
  },
  {
    id: 'vid-pop-22',
    youtubeId: 'VMSCL3jOfjU',
    title: "Hallelujah Chorus | TELC Adaikalanathar & Arulnathar Lutheran Church Choir | Ebenezer ArunKumar",
    artist: "TELC Lutheran Church Choir",
    category: 'Choral',
    duration: '03:46',
    views: '883',
    viewsCount: 883,
    publishedAt: '6 months ago',
    description: "Handel's mighty Hallelujah Chorus from Messiah presented live by the combined choirs under Ebenezer ArunKumar.",
    likesCount: 95,
    thumbnailUrl: "https://i.ytimg.com/vi/VMSCL3jOfjU/hqdefault.jpg"
  },
  {
    id: 'vid-pop-23',
    youtubeId: 'Y1CB5pwiPP0',
    title: "மகிழ்வோம் மகிழ்வோம் | Magizhvom Magizhvom Live | 3 Part Harmony | Tamil Christian Song | 01 Feb 2026",
    artist: "3 Part Harmony Choir",
    category: 'Vocal',
    duration: '04:01',
    views: '873',
    viewsCount: 873,
    publishedAt: '8 months ago',
    description: "An incredibly moving 3-part vocal harmony performance of 'Magizhvom Magizhvom' recorded live in Chennai.",
    likesCount: 88,
    thumbnailUrl: "https://i.ytimg.com/vi/Y1CB5pwiPP0/hqdefault.jpg"
  },
  {
    id: '-GxvcsgIv5Q',
    youtubeId: '-GxvcsgIv5Q',
    title: "Where Could I Go? | Spent Force | Gaither Vocal Band Cover | Music Madras",
    artist: "Spent Force",
    category: 'Vocal',
    duration: '03:41',
    views: '789',
    viewsCount: 789,
    publishedAt: '3 months ago',
    description: "Southern gospel classic 'Where Could I Go?' covered by Spent Force with warm acoustic blend.",
    likesCount: 70,
    thumbnailUrl: "https://i.ytimg.com/vi/-GxvcsgIv5Q/hqdefault.jpg"
  },
  {
    id: 'vid-pop-25',
    youtubeId: 'jiNrP52imwg',
    title: "Ding Dong Merrily, In the Beginning, Love Came Gently| BHC Choir | MCC | Jacob George",
    artist: "BHC Choir & Jacob George",
    category: 'Choral',
    duration: '11:04',
    views: '751',
    viewsCount: 751,
    publishedAt: '10 months ago',
    description: "Choral suite of Christmas hymns performed live at Madras Christian College.",
    likesCount: 84,
    thumbnailUrl: "https://i.ytimg.com/vi/jiNrP52imwg/hqdefault.jpg"
  },
  {
    id: 'vid-pop-26',
    youtubeId: 'GoK7GUIhSd4',
    title: "Loving God | Spent Force | TELC Arulnathar Lutheran Church | Music Madras",
    artist: "Spent Force",
    category: 'Vocal',
    duration: '03:14',
    views: '735',
    viewsCount: 735,
    publishedAt: '3 months ago',
    description: "Inspiring contemporary sacred ballad recorded live in church sanctuary.",
    likesCount: 65,
    thumbnailUrl: "https://i.ytimg.com/vi/GoK7GUIhSd4/hqdefault.jpg"
  },
  {
    id: 'vid-pop-27',
    youtubeId: 'GtMpTCmC1QA',
    title: "Mozart: Coronation Mass in C Major - Kyrie | The Chennai Chorale | Augustine Paul",
    artist: "The Chennai Chorale & Augustine Paul",
    category: 'Choral',
    duration: '02:16',
    views: '715',
    viewsCount: 715,
    publishedAt: '9 days ago',
    description: "The stirring Kyrie movement from Mozart's Coronation Mass in C Major, presented live by The Chennai Chorale under Augustine Paul.",
    likesCount: 68,
    thumbnailUrl: "https://i.ytimg.com/vi/GtMpTCmC1QA/hqdefault.jpg"
  },
  {
    id: 'vid-pop-28',
    youtubeId: 'rxGfBGWLnTI',
    title: "பாலன் பிறந்த ராவில் | Paalan Pirandha Raavil | Finley Abraham | BHC Choir| MCC | 12 Dec 2025",
    artist: "Finley Abraham & BHC Choir",
    category: 'Choral',
    duration: '03:46',
    views: '636',
    viewsCount: 636,
    publishedAt: '10 months ago',
    description: "Finley Abraham's Tamil carol 'Paalan Pirandha Raavil' with orchestral choir accompaniment.",
    likesCount: 62,
    thumbnailUrl: "https://i.ytimg.com/vi/rxGfBGWLnTI/hqdefault.jpg"
  },
  {
    id: 'vid-pop-29',
    youtubeId: 'MX-ymOF_-wg',
    title: "மானிடரை மீட்டெடுக்க |  Maanidarai Meeteduka | ECI Hope Cathedral Choir | Tamil Christmas Carol",
    artist: "ECI Hope Cathedral Choir",
    category: 'Choral',
    duration: '04:51',
    views: '578',
    viewsCount: 578,
    publishedAt: '10 months ago',
    description: "Festive Tamil carol recorded live at ECI Hope Cathedral.",
    likesCount: 55,
    thumbnailUrl: "https://i.ytimg.com/vi/MX-ymOF_-wg/hqdefault.jpg"
  },
  {
    id: 'vid-pop-30',
    youtubeId: 'u-_ZWmIIP6s',
    title: "Pachelbel's Canon in D Major | Pipe Organ | Christian Wedding Song | Arul Siromoney | Music Madras",
    artist: "Arul Siromoney (Pipe Organ)",
    category: 'Organ',
    duration: '06:37',
    views: '540',
    viewsCount: 540,
    publishedAt: '4 weeks ago',
    description: "Johann Pachelbel's timeless Canon in D Major rendered on pipe organ by master organist Arul Siromoney.",
    likesCount: 58,
    thumbnailUrl: "https://i.ytimg.com/vi/u-_ZWmIIP6s/hqdefault.jpg"
  },
  {
    id: 'vid-pop-31',
    youtubeId: '-mWc17pyV78',
    title: "Mozart: Symphony No. 41 Jupiter | Alvin Arumugam l South Asian Symphony Orchestra",
    artist: "SASO & Alvin Arumugam",
    category: 'Concert',
    duration: '11:55',
    views: '380',
    viewsCount: 380,
    publishedAt: '5 months ago',
    description: "A symphonic performance of W.A. Mozart's final symphony 'Jupiter' (No. 41) under the baton of Alvin Arumugam.",
    likesCount: 45,
    thumbnailUrl: "https://i.ytimg.com/vi/-mWc17pyV78/hqdefault.jpg"
  },
  {
    id: 'vid-pop-32',
    youtubeId: 'LfrK4o-pSwU',
    title: "Appalachian Spring Excerpt | Copland | South Asian Symphony Orchestra | Alvin Arumugam | 24 May 2026",
    artist: "SASO & Alvin Arumugam",
    category: 'Instrumental',
    duration: '06:45',
    views: '340',
    viewsCount: 340,
    publishedAt: '1 month ago',
    description: "A beautiful and expressive live performance of Aaron Copland's masterpiece Appalachian Spring by SASO.",
    likesCount: 38,
    thumbnailUrl: "https://i.ytimg.com/vi/LfrK4o-pSwU/hqdefault.jpg"
  },
  {
    id: 'vid-pop-33',
    youtubeId: 'mfbJu3HQJOA',
    title: "Saint-Saëns: The Swan - Masterpiece of Romanticism | by Raman Ramakrishnan & Stephen Prutsman",
    artist: "Raman Ramakrishnan & Stephen Prutsman",
    category: 'Instrumental',
    duration: '03:15',
    views: '320',
    viewsCount: 320,
    publishedAt: '3 months ago',
    description: "The elegant 'The Swan' by Camille Saint-Saëns, performed live by cellist Raman Ramakrishnan and pianist Stephen Prutsman.",
    likesCount: 35,
    thumbnailUrl: "https://i.ytimg.com/vi/mfbJu3HQJOA/hqdefault.jpg"
  },
  {
    id: 'vid-pop-34',
    youtubeId: 'dkZoPqBh5_I',
    title: "The Pink Panther | Henry Mancini | The English Brass Collective",
    artist: "The English Brass Collective",
    category: 'Instrumental',
    duration: '02:40',
    views: '285',
    viewsCount: 285,
    publishedAt: '4 months ago',
    description: "Henry Mancini's legendary theme 'The Pink Panther' performed by the English Brass Collective live in Chennai.",
    likesCount: 28,
    thumbnailUrl: "https://i.ytimg.com/vi/dkZoPqBh5_I/hqdefault.jpg"
  },
  {
    id: 'vid-pop-35',
    youtubeId: 'GqJklOeZaEc',
    title: "Autumn Leaves | Johnny Mercer | The English Brass Collective",
    artist: "The English Brass Collective",
    category: 'Instrumental',
    duration: '03:10',
    views: '240',
    viewsCount: 240,
    publishedAt: '2 months ago',
    description: "A rich brass arrangement of Johnny Mercer's Autumn Leaves performed live with gorgeous warm resonance.",
    likesCount: 24,
    thumbnailUrl: "https://i.ytimg.com/vi/GqJklOeZaEc/hqdefault.jpg"
  },
  {
    id: 'vid-pop-36',
    youtubeId: '72g8yxnCK84',
    title: "God Will Take Care of You | Piano Cover | 4 Hands | TELC Arulnathar Lutheran Church | 01Feb 2026",
    artist: "Four Hands Piano Duo",
    category: 'Instrumental',
    duration: '04:05',
    views: '215',
    viewsCount: 215,
    publishedAt: '3 weeks ago',
    description: "A beautiful four-hands piano duet of 'God Will Take Care of You', recorded live in Chennai.",
    likesCount: 22,
    thumbnailUrl: "https://i.ytimg.com/vi/72g8yxnCK84/hqdefault.jpg"
  },
  {
    id: 'vid-pop-37',
    youtubeId: '3-bC6U7gN0E',
    title: "Beethoven - Cello Sonata No. 4 in C Major, Op. 102, No. 1 by Raman Ramakrishnan & Stephen Prutsman",
    artist: "Raman Ramakrishnan & Stephen Prutsman",
    category: 'Instrumental',
    duration: '14:20',
    views: '195',
    viewsCount: 195,
    publishedAt: '4 months ago',
    description: "Beethoven's intricate and beautiful Cello Sonata No. 4, performed live in an intimate chamber setting in Chennai.",
    likesCount: 20,
    thumbnailUrl: "https://i.ytimg.com/vi/3-bC6U7gN0E/hqdefault.jpg"
  }
];

export const PLAYLISTS_DATA: Playlist[] = [
  {
    id: 'PLY1Yefuyk0BI',
    title: "Christian Wedding Music | Tamil Wedding Songs, Hymns & Classical Wedding Music | Music Madras",
    videoCount: 9,
    description: "Curated wedding hymns, sacred marches, and Tamil Christian bridal music recorded live.",
    youtubeUrl: "https://www.youtube.com/playlist?list=PLY1Yefuyk0BI",
    imageQuery: 'wedding',
    thumbnailUrl: "https://i.ytimg.com/vi/rUrS7Pb2W90/hqdefault.jpg"
  },
  {
    id: 'PLf4CcKxuKJvg',
    title: "Mozart: Coronation Mass in C Major, K. 317 | Complete Mass | Music Madras",
    videoCount: 6,
    description: "Complete live movements of W.A. Mozart's Coronation Mass in C Major performed by The Chennai Chorale.",
    youtubeUrl: "https://www.youtube.com/playlist?list=PLf4CcKxuKJvg",
    imageQuery: 'choral',
    thumbnailUrl: "https://i.ytimg.com/vi/GtMpTCmC1QA/hqdefault.jpg"
  },
  {
    id: 'PLZf6nqKmvUHg',
    title: "Musical Sunday | TELC Arulnathar Church | Chennai | 06 September 2026",
    videoCount: 16,
    description: "Sacred Sunday choral, solo vocal, and liturgical performances live at TELC Arulnathar Church.",
    youtubeUrl: "https://www.youtube.com/playlist?list=PLZf6nqKmvUHg",
    imageQuery: 'church',
    thumbnailUrl: "https://i.ytimg.com/vi/GtMpTCmC1QA/hqdefault.jpg"
  },
  {
    id: 'PL6HjF0ftgoqukPMVied3OlVd0zT-Imjir',
    title: "EMC Choir Homecoming - Jan 2026 | Kalyan Subrahmanyam",
    videoCount: 28,
    description: "The Emmanuel Methodist Church (EMC) Choir Homecoming performances under the direction of Kalyan Subrahmanyam.",
    youtubeUrl: "https://www.youtube.com/playlist?list=PL6HjF0ftgoqukPMVied3OlVd0zT-Imjir",
    imageQuery: 'singing',
    thumbnailUrl: "https://i.ytimg.com/vi/NywlHEmY8YY/hqdefault.jpg"
  },
  {
    id: 'PL6HjF0ftgoqukHKfMBYbjvIYwExv-zqCo',
    title: "The Chromatics - Sacred Arias Chromatics by Haydn, Mozart, Puccini, Stradella, Mendelssohn, Verdi",
    videoCount: 13,
    description: "Curated sacred arias and classical works performed live by the renowned vocal ensemble The Chromatics.",
    youtubeUrl: "https://www.youtube.com/playlist?list=PL6HjF0ftgoqukHKfMBYbjvIYwExv-zqCo",
    imageQuery: 'choir',
    thumbnailUrl: "https://i.ytimg.com/vi/GrHZCVTGj1I/hqdefault.jpg"
  },
  {
    id: 'PL6HjF0ftgoqvL10ZDw8kx3OLIP6VV8T97',
    title: "Bishop Heber Chapel Choir ( BHC ) - Christmas Carols 2025",
    videoCount: 11,
    description: "Christmas Carols services and special hymns performed live by the Bishop Heber Chapel Choir.",
    youtubeUrl: "https://www.youtube.com/playlist?list=PL6HjF0ftgoqvL10ZDw8kx3OLIP6VV8T97",
    imageQuery: 'carols',
    thumbnailUrl: "https://i.ytimg.com/vi/jiNrP52imwg/hqdefault.jpg"
  },
  {
    id: 'PL6HjF0ftgoqui84vnHtk_1MfaqUZKeOPf',
    title: "SASO - Mozart's Symphony No. 41, Gershwin's Rhapsody in Blue, and more",
    videoCount: 3,
    description: "Magnificent symphonic orchestral programs performed by the South Asian Symphony Orchestra (SASO) live in Chennai.",
    youtubeUrl: "https://www.youtube.com/playlist?list=PL6HjF0ftgoqui84vnHtk_1MfaqUZKeOPf",
    imageQuery: 'orchestra',
    thumbnailUrl: "https://i.ytimg.com/vi/kFMY76NTCs8/hqdefault.jpg"
  },
  {
    id: 'PL6HjF0ftgoqs7cZ69mdJqfoYIQKFkCPAy',
    title: "A Journey Across Genres - The MMA & EBC",
    videoCount: 22,
    description: "A collaborative concert series between the Madras Musical Association and English Brass Collective.",
    youtubeUrl: "https://www.youtube.com/playlist?list=PL6HjF0ftgoqs7cZ69mdJqfoYIQKFkCPAy",
    imageQuery: 'brass',
    thumbnailUrl: "https://i.ytimg.com/vi/i6wb5LKamOc/hqdefault.jpg"
  },
  {
    id: 'PL6HjF0ftgoquW81zBjg1r2s0h8fKUiWdb',
    title: "The Music Madras 2025 Christmas Carol Collection",
    videoCount: 21,
    description: "Festive season Christmas carols captured across historical churches and concert halls in Chennai.",
    youtubeUrl: "https://www.youtube.com/playlist?list=PL6HjF0ftgoquW81zBjg1r2s0h8fKUiWdb",
    imageQuery: 'christmas',
    thumbnailUrl: "https://i.ytimg.com/vi/8oa2qCWecCU/hqdefault.jpg"
  },
  {
    id: 'PL6HjF0ftgoqvYdWbKZgILccVsXHq_xvYP',
    title: "Carols by Candlelight 2025",
    videoCount: 11,
    description: "Atmospheric candlelit evening of choral carols and sacred hymns recorded live in Chennai.",
    youtubeUrl: "https://www.youtube.com/playlist?list=PL6HjF0ftgoqvYdWbKZgILccVsXHq_xvYP",
    imageQuery: 'candlelight',
    thumbnailUrl: "https://i.ytimg.com/vi/obOSTyeweyo/hqdefault.jpg"
  },
  {
    id: 'PL6HjF0ftgoqusr1mpK4sCbJU7iwdm4CH5',
    title: "TELC Arulnathar Lutheran Church",
    videoCount: 21,
    description: "Full service recordings, pipe organ preludes, and congregational anthems from TELC Arulnathar Church.",
    youtubeUrl: "https://www.youtube.com/playlist?list=PL6HjF0ftgoqusr1mpK4sCbJU7iwdm4CH5",
    imageQuery: 'church',
    thumbnailUrl: "https://i.ytimg.com/vi/FJBRS2J-DIQ/hqdefault.jpg"
  },
  {
    id: 'PL6HjF0ftgoqtIFRkJLkEqeaFLe4ddhjt3',
    title: "Messa di Gloria by Giacomo Puccini | Madras Musical Association | Augustine Paul | St Andrews' Kirk",
    videoCount: 4,
    description: "Giacomo Puccini's dramatic Messa di Gloria performed by the Madras Musical Association under Augustine Paul.",
    youtubeUrl: "https://www.youtube.com/playlist?list=PL6HjF0ftgoqtIFRkJLkEqeaFLe4ddhjt3",
    imageQuery: 'mass',
    thumbnailUrl: "https://i.ytimg.com/vi/rX5inzi4gvU/hqdefault.jpg"
  },
  {
    id: 'PL6HjF0ftgoqtJk_OoDCi2P_8h-7IQ5GCK',
    title: "Beethoven Cello Sonatas - 18 March 2026",
    videoCount: 4,
    description: "Masterful interpretations of Ludwig van Beethoven's cello sonatas recorded live in acoustic fidelity.",
    youtubeUrl: "https://www.youtube.com/playlist?list=PL6HjF0ftgoqtJk_OoDCi2P_8h-7IQ5GCK",
    imageQuery: 'cello',
    thumbnailUrl: "https://i.ytimg.com/vi/Pl08HHriJg4/hqdefault.jpg"
  },
  {
    id: 'PLa2-iQevKyXA',
    title: "The Spent Force - TELC Arulnathar Lutheran Church",
    videoCount: 3,
    description: "Acoustic gospel vocal quartet performances by Spent Force at TELC Arulnathar Church.",
    youtubeUrl: "https://www.youtube.com/playlist?list=PLa2-iQevKyXA",
    imageQuery: 'quartet',
    thumbnailUrl: "https://i.ytimg.com/vi/GoK7GUIhSd4/hqdefault.jpg"
  },
  {
    id: 'PLBSgc9UMeCmE',
    title: "Musical Sunday (05 July 26) TELC Arulnathar Church",
    videoCount: 17,
    description: "Liturgical music, choral responses, and pipe organ anthems recorded live at TELC Arulnathar Church.",
    youtubeUrl: "https://www.youtube.com/playlist?list=PLBSgc9UMeCmE",
    imageQuery: 'organ',
    thumbnailUrl: "https://i.ytimg.com/vi/4lXPhchmoJo/hqdefault.jpg"
  }
];

export const COMMUNITY_POSTS: CommunityPost[] = [
  {
    id: 'post-1',
    date: '3 days ago',
    content: "🎙️ ACOUSTIC INTEGRITY: Our recording setup is optimized for the natural resonance of historical halls like St. Andrew's Kirk or St. George's Cathedral. Instead of heavily EQ'ing and over-compressing the audio, we let the true acoustics shine through. Using matched premium condenser microphone pairs, we capture the pure, unadulterated live balance intended for the physical audience. No extreme post-production—just honest harmony.",
    likes: 245,
    comments: 18
  },
  {
    id: 'post-2',
    date: '1 week ago',
    content: "🎥 DYNAMIC 4K DISCREET RECORDING: Performing in front of a giant cinema rig can feel sterile. That's why we use high-grade flagship mobile cameras mounted strategically around the venue. Our setups are silent (no camera cooling fan noise!), small, and completely non-distracting. This allows us to deliver stunning 4K single/multi-cam 4K capture perspectives and mastered stereo sound within 2-3 business days.",
    likes: 189,
    comments: 12
  },
  {
    id: 'post-3',
    date: '2 weeks ago',
    content: "🤝 FREE COLLABORATION OFFER: If you are an upcoming or established artist performing a recital, concert, or choral service in Chennai, we will record your event completely FREE of charge. In exchange, the performance is shared on our YouTube channel @MusicMadras under a collaboration. Performers receive the uncompressed 4K files and pristine high-resolution stereo master to share freely on their personal Instagram and socials!",
    likes: 312,
    comments: 34
  }
];

export const TECHNICAL_EQUIPMENT = [
  {
    category: 'Microphones',
    items: [
      { name: 'sE Electronics Matched-Pair Stereo Condensers', purpose: 'Handcrafted small-diaphragm true condenser capsules with a transformerless Class-A design, providing ultra-low noise, pristine live transient response, switchable attenuation pads, and low-cut filters for raw acoustic clarity.' },
      { name: 'Neutrik XLR Connectors Only', purpose: 'We only use high-quality, professional-grade Neutrik XLR connectors to guarantee perfect balanced signal shielding, minimum contact resistance, and ultimate noise immunity.' }
    ]
  },
  {
    category: 'Preamps & Converters',
    items: [
      { name: 'Focusrite Preamps & Converters', purpose: 'Features the switchable Air mode to recreate the brighter, more open sound of classic studio consoles, coupled with high-performance 24-bit/192kHz A/D converters and high-headroom instrument inputs.' },
      { name: 'Blackstar Preamps', purpose: 'Equipped with an ultra-high headroom FET input stage to prevent digital clipping, plus a unique Enhance switch that introduces natural harmonic warmth and high-frequency sparkle of valve amplifiers.' }
    ]
  },
  {
    category: 'Video & Silent Rigs',
    items: [
      { name: 'Flagship Mobile 4K Cameras', purpose: 'Superb 4K resolution capture on flagship mobile sensors. Mounted on sleek, silent, low-profile stands.' },
      { name: 'Pure Acoustic Post-Processing', purpose: 'Basic gain-staging, level-matching, and alignment without over-processing or artificial enhancements.' }
    ]
  }
];
