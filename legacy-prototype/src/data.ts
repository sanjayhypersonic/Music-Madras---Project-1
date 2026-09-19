import { Video, Playlist, CommunityPost } from './types';

export const CHANNEL_INFO = {
  name: 'Music Madras',
  handle: '@MusicMadras',
  url: 'https://www.youtube.com/@MusicMadras',
  description: 'Music Madras: A Pure Live Experience - Digital Archive',
  detailedDescription: 'Welcome to Music Madras, your front-row seat to the authentic sound of Western and Indian classical concerts in Chennai. This includes Church Music. In an era of over-processed live recordings, we believe something vital is lost when the "concert hall sound" is sanitized by extreme post-production. Our mission is to bridge that gap. We celebrate the "perfectly imperfect" nature of live music, capturing the blend and balance intended for the live audience.',
  subscribers: '12.4K',
  videoCount: '184',
  totalViews: '1.2M',
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
    id: 'vid-1',
    youtubeId: 'zEQmnmwr5UE',
    title: "Dingiri Dingalae | SASO | Alvin Arumugam | Arr. Augustine Paul | The Chennai Chorale",
    artist: "SASO & The Chennai Chorale",
    category: 'Concert',
    duration: '03:47',
    views: '22,774',
    publishedAt: '6mo ago',
    description: "A spectacular performance of 'Dingiri Dingalae' by The South Asian Symphony Orchestra (SASO) and The Chennai Chorale, conducted by Alvin Arumugam. Arranged by Augustine Paul.",
    likesCount: 145,
    thumbnailUrl: "https://img.youtube.com/vi/zEQmnmwr5UE/mqdefault.jpg"
  },
  {
    id: 'vid-2',
    youtubeId: 'PpuO1CxaN5A',
    title: "Ambara Umbara I Tamil Christian Song I Tamil Christmas Traditional Song",
    artist: "Bishop Heber Chapel Choir",
    category: 'Vocal',
    duration: '03:31',
    views: '713',
    publishedAt: '5 months ago',
    description: "A beautiful, authentic live choral performance of the traditional Tamil Christmas song 'Ambara Umbara' by the Bishop Heber Chapel Choir. High-fidelity live audio capturing the natural room acoustics.",
    likesCount: 98,
    thumbnailUrl: "https://img.youtube.com/vi/PpuO1CxaN5A/mqdefault.jpg"
  },
  {
    id: 'vid-3',
    youtubeId: 'm2THfAiraY8',
    title: "The best of Mozart and Verdi | SASO | Alvin Arumugam | The Chennai Chorale | Nov 30 2024",
    artist: "SASO & The Chennai Chorale",
    category: 'Concert',
    duration: '06:12',
    views: '296',
    publishedAt: '6 months ago',
    description: "An evening of magnificent classical masterworks featuring the best of Wolfgang Amadeus Mozart and Giuseppe Verdi, performed live by SASO and The Chennai Chorale under Alvin Arumugam.",
    likesCount: 189,
    thumbnailUrl: "https://img.youtube.com/vi/m2THfAiraY8/mqdefault.jpg"
  },
  {
    id: 'vid-4',
    youtubeId: 'c1TpR1AU478',
    title: "Show A Little Bit of Love and Kindness | EMC Alumni Choir | Emmanuel Methodist Church | Homecoming",
    artist: "EMC Alumni Choir",
    category: 'Choral',
    duration: '03:52',
    views: '221',
    publishedAt: 'Streamed 11 hours ago',
    description: "The beautiful anthem 'Show A Little Bit of Love and Kindness' performed live by the EMC Alumni Choir during the Emmanuel Methodist Church Homecoming service in Chennai.",
    likesCount: 76,
    thumbnailUrl: "https://img.youtube.com/vi/c1TpR1AU478/mqdefault.jpg"
  },
  {
    id: 'vid-5',
    youtubeId: 'dkZoPqBh5_I',
    title: "The Pink Panther | Henry Mancini | The English Brass Collective",
    artist: "The English Brass Collective",
    category: 'Instrumental',
    duration: '02:40',
    views: '75',
    publishedAt: '4 months ago',
    description: "Henry Mancini's legendary theme 'The Pink Panther' performed with precision and humor by the English Brass Collective live in Chennai. Captured via discrete low-profile silent stand systems.",
    likesCount: 122,
    thumbnailUrl: "https://img.youtube.com/vi/dkZoPqBh5_I/mqdefault.jpg"
  },
  {
    id: 'vid-6',
    youtubeId: '2e3fEU-lNF8',
    title: "Ride on! Ride on in Majesty | Christian Hymn | Bishop Heber Chapel | Congregation Choir",
    artist: "Bishop Heber Chapel Congregation Choir",
    category: 'Choral',
    duration: '05:01',
    views: '130',
    publishedAt: '2 months ago',
    description: "The majestic Christian hymn 'Ride on! Ride on in Majesty' performed by the Bishop Heber Chapel Congregation Choir, recorded live with studio-quality audio.",
    likesCount: 254,
    thumbnailUrl: "https://img.youtube.com/vi/2e3fEU-lNF8/mqdefault.jpg"
  },
  {
    id: 'vid-7',
    youtubeId: 'itlXsCnRqN4',
    title: "If God Be For Us | The Canticles | TELC Arulnathar Lutheran Church | Ebenezer ArunKumar",
    artist: "The Canticles & Ebenezer ArunKumar",
    category: 'Choral',
    duration: '04:15',
    views: '159',
    publishedAt: '2 months ago',
    description: "A stunning sacred vocal performance of 'If God Be For Us' by The Canticles live at the TELC Arulnathar Lutheran Church, directed by Ebenezer ArunKumar.",
    likesCount: 210,
    thumbnailUrl: "https://img.youtube.com/vi/itlXsCnRqN4/mqdefault.jpg"
  },
  {
    id: 'vid-8',
    youtubeId: 'Y1CB5pwiPP0',
    title: "மகிழ்வோம் மகிழ்வோம் | Magizhvom Magizhvom Live | 3 Part Harmony | Tamil Christian Song | 01 Feb 2026",
    artist: "3 Part Harmony Choir",
    category: 'Vocal',
    duration: '04:55',
    views: '668',
    publishedAt: '4 months ago',
    description: "An incredibly moving 3-part vocal harmony performance of 'Magizhvom Magizhvom' recorded live in Chennai. Focused on high-fidelity, natural blending without heavy digital compression.",
    likesCount: 88,
    thumbnailUrl: "https://img.youtube.com/vi/Y1CB5pwiPP0/mqdefault.jpg"
  },
  {
    id: 'vid-9',
    youtubeId: 'yml5CPj_EtA',
    title: "Joseph Haydn - In Native Worth, performed by Prashanth Gasper | The Chromatics",
    artist: "Prashanth Gasper & The Chromatics",
    category: 'Vocal',
    duration: '03:10',
    views: '46',
    publishedAt: '3 months ago',
    description: "Joseph Haydn's gorgeous classical aria 'In Native Worth' from The Creation, beautifully delivered by tenor Prashanth Gasper accompanied by The Chromatics ensemble.",
    likesCount: 114,
    thumbnailUrl: "https://img.youtube.com/vi/yml5CPj_EtA/mqdefault.jpg"
  },
  {
    id: 'vid-10',
    youtubeId: 'rfAg0EcmqNs',
    title: "Crown Him with Many Crowns | TELC Arulnathar Lutheran Church Congregation Hymn | Jeremiah Christopher",
    artist: "Jeremiah Christopher & TELC Congregation",
    category: 'Organ',
    duration: '05:33',
    views: '80',
    publishedAt: '1mo ago',
    description: "The beloved traditional hymn 'Crown Him with Many Crowns' performed with stunning power by the congregation at TELC Arulnathar Lutheran Church, conducted by Jeremiah Christopher.",
    likesCount: 167,
    thumbnailUrl: "https://img.youtube.com/vi/rfAg0EcmqNs/mqdefault.jpg"
  },
  {
    id: 'vid-11',
    youtubeId: 'UWpwnWw8LqU',
    title: "Thine be the Glory | Maccabeus | Noel Rawsthorne | Jeremiah Christopher | Pipe Organ | The Kirk",
    artist: "Jeremiah Christopher",
    category: 'Organ',
    duration: '04:12',
    views: '2.3K',
    publishedAt: '1 month ago',
    description: "Noel Rawsthorne's magnificent arrangement of Thine be the Glory performed on the grand pipe organ at St. Andrew's Church (The Kirk), Chennai, by Jeremiah Christopher.",
    likesCount: 142,
    thumbnailUrl: "https://img.youtube.com/vi/UWpwnWw8LqU/mqdefault.jpg"
  },
  {
    id: 'vid-12',
    youtubeId: '569XzRYeeEc',
    title: "Glorious things of thee | Kirk Sound Experiments | AB 90 Ins Air - ON | Unedited | 7ft Side | Pro",
    artist: "Kirk Organist",
    category: 'Organ',
    duration: '03:55',
    views: '1.1K',
    publishedAt: '3 months ago',
    description: "Live recording from the St. Andrew's Church (The Kirk), Chennai, capturing the rich, spacious pipe organ acoustics with specialized microphone setups.",
    likesCount: 65,
    thumbnailUrl: "https://img.youtube.com/vi/569XzRYeeEc/mqdefault.jpg"
  },
  {
    id: 'vid-13',
    youtubeId: 'Cch3sMiHWqY',
    title: "Mid summer's dream",
    artist: "Music Madras Organ Ensemble",
    category: 'Organ',
    duration: '05:18',
    views: '920',
    publishedAt: '2 months ago',
    description: "A serene and meditative organ performance captured live in the natural room acoustics of Chennai's classic architecture.",
    likesCount: 48,
    thumbnailUrl: "https://img.youtube.com/vi/Cch3sMiHWqY/mqdefault.jpg"
  },
  {
    id: 'vid-14',
    youtubeId: 'qBg0IGBqreU',
    title: "God Is Gone Up With A Shout | The Canticles | TELC Arulnathar Lutheran Church | Ebenezer ArunKumar",
    artist: "The Canticles & Ebenezer ArunKumar",
    category: 'Organ',
    duration: '03:42',
    views: '1.5K',
    publishedAt: '4 months ago',
    description: "A magnificent choral anthem with soaring organ accompaniment performed live at TELC Arulnathar Lutheran Church.",
    likesCount: 110,
    thumbnailUrl: "https://img.youtube.com/vi/qBg0IGBqreU/mqdefault.jpg"
  },
  {
    id: 'vid-15',
    youtubeId: 'sGBUfjb5Ip8',
    title: "He shall feed His flock (Messiah - G.F. Händel) | Sherly Sam | Malavika | Immanuel Thiyageswaran",
    artist: "Sherly Sam, Malavika & Immanuel Thiyageswaran",
    category: 'Organ',
    duration: '05:45',
    views: '1.9K',
    publishedAt: '3 weeks ago',
    description: "A beautiful vocal duet from Handel's Messiah, accompanied by the pipe organ, recorded live in Chennai.",
    likesCount: 95,
    thumbnailUrl: "https://img.youtube.com/vi/sGBUfjb5Ip8/mqdefault.jpg"
  },
  {
    id: 'vid-16',
    youtubeId: '94RXvzXhAa0',
    title: "Witness - Lloyd Larson | TELC Adaikalanathar & Arulnathar Lutheran Church Choir | Ebenezer ArunKumar",
    artist: "TELC Church Choir & Ebenezer ArunKumar",
    category: 'Choral',
    duration: '04:10',
    views: '2.2K',
    publishedAt: '5 months ago',
    description: "Lloyd Larson's powerful 'Witness' performed live by the joint choir of TELC Adaikalanathar & Arulnathar Lutheran Churches in Chennai.",
    likesCount: 130,
    thumbnailUrl: "https://img.youtube.com/vi/94RXvzXhAa0/mqdefault.jpg"
  },
  {
    id: 'vid-17',
    youtubeId: 'U9rjKmECbSU',
    title: "Holy Spirit Living Breath of God | Lloyd Larson | TELC Arulnathar Lutheran Church Choir | Ebenezer A",
    artist: "TELC Arulnathar Lutheran Church Choir & Ebenezer ArunKumar",
    category: 'Choral',
    duration: '04:35',
    views: '1.7K',
    publishedAt: '2 months ago',
    description: "A deeply moving choral prayer, Holy Spirit Living Breath of God, arranged by Lloyd Larson, recorded live.",
    likesCount: 88,
    thumbnailUrl: "https://img.youtube.com/vi/U9rjKmECbSU/mqdefault.jpg"
  },
  {
    id: 'vid-18',
    youtubeId: 'LZOy4hhKCK4',
    title: "Thamil Osai Choir | Carols by Candlelight 2025 | Tamil Christmas Carol",
    artist: "Thamil Osai Choir",
    category: 'Choral',
    duration: '03:50',
    views: '1.4K',
    publishedAt: '6 months ago',
    description: "An exquisite Tamil Christmas Carol performed live during the annual Carols by Candlelight service in Chennai.",
    likesCount: 75,
    thumbnailUrl: "https://img.youtube.com/vi/LZOy4hhKCK4/mqdefault.jpg"
  },
  {
    id: 'vid-19',
    youtubeId: 'fU6QstgYR8Q',
    title: "Lacrimosa - Requiem KV626 (W.A. Mozart) | SASO | Alvin Arumugam | The Chennai Chorale",
    artist: "SASO & The Chennai Chorale",
    category: 'Choral',
    duration: '03:22',
    views: '3.5K',
    publishedAt: '1 month ago',
    description: "A profound, soaring performance of Mozart's Lacrimosa by the South Asian Symphony Orchestra and The Chennai Chorale.",
    likesCount: 220,
    thumbnailUrl: "https://img.youtube.com/vi/fU6QstgYR8Q/mqdefault.jpg"
  },
  {
    id: 'vid-20',
    youtubeId: 'eXRvL-ilkiE',
    title: "Ol' Time Religion | | EMC Alumni Choir | Emmanuel Methodist Church | Homecoming Concert 2026",
    artist: "EMC Alumni Choir",
    category: 'Choral',
    duration: '02:58',
    views: '1.1K',
    publishedAt: '4 months ago',
    description: "An energetic, joyful spiritual anthem performed live during the EMC Choir Homecoming Concert in Chennai.",
    likesCount: 82,
    thumbnailUrl: "https://img.youtube.com/vi/eXRvL-ilkiE/mqdefault.jpg"
  },
  {
    id: 'vid-21',
    youtubeId: 'P6KS7xhIGWs',
    title: "I Come to the Garden | GATT Quintet | EMC Alumni Choir | Emmanuel Methodist Church |Homecoming 2026",
    artist: "GATT Quintet & EMC Alumni Choir",
    category: 'Choral',
    duration: '04:15',
    views: '1.3K',
    publishedAt: '3 months ago',
    description: "The beloved hymn 'I Come to the Garden', beautifully performed live in 5-part harmony at Emmanuel Methodist Church.",
    likesCount: 94,
    thumbnailUrl: "https://img.youtube.com/vi/P6KS7xhIGWs/mqdefault.jpg"
  },
  {
    id: 'vid-22',
    youtubeId: 'V2Imi2WvlM8',
    title: "I Will Follow • Psalms 23 • Smrithi Sasikumar • Genesis Chamber Orchestra",
    artist: "Smrithi Sasikumar & Genesis Chamber Orchestra",
    category: 'Choral',
    duration: '05:12',
    views: '2.6K',
    publishedAt: '7 months ago',
    description: "A majestic setting of Psalm 23 performed live in Chennai with lush string orchestration and crystal-clear vocals.",
    likesCount: 165,
    thumbnailUrl: "https://img.youtube.com/vi/V2Imi2WvlM8/mqdefault.jpg"
  },
  {
    id: 'vid-23',
    youtubeId: 'KNNYXoHhl3o',
    title: "Joseph Haydn - Sing the Lord from 'The Creation'",
    artist: "Chamber Choir & Ensemble",
    category: 'Choral',
    duration: '04:45',
    views: '1.8K',
    publishedAt: '2 months ago',
    description: "Haydn's triumphant chorus 'Sing the Lord' from his masterpiece oratorio 'The Creation', captured live with stunning fidelity.",
    likesCount: 115,
    thumbnailUrl: "https://img.youtube.com/vi/KNNYXoHhl3o/mqdefault.jpg"
  },
  {
    id: 'vid-24',
    youtubeId: '1m8t8IwkDHs',
    title: "Chinnachiru Suthane | Carols by Candlelight 2025 | WCC Choir | Christmas Carols 2025",
    artist: "WCC Choir",
    category: 'Choral',
    duration: '04:02',
    views: '2.1K',
    publishedAt: '6 months ago',
    description: "The elegant Tamil Christmas Carol 'Chinnachiru Suthane' performed live during the annual Carols by Candlelight service.",
    likesCount: 140,
    thumbnailUrl: "https://img.youtube.com/vi/1m8t8IwkDHs/mqdefault.jpg"
  },
  {
    id: 'vid-25',
    youtubeId: 'YMK86f4aEr8',
    title: "Domine Deus - G Rossini | Petite Messe Solennelle | Ebenezer ArunKumar | Immanuel Thiyageswaran",
    artist: "Ebenezer ArunKumar & Immanuel Thiyageswaran",
    category: 'Vocal',
    duration: '05:30',
    views: '1.5K',
    publishedAt: '5 months ago',
    description: "A soaring, powerful performance of Rossini's Domine Deus from Petite Messe Solennelle, recorded live.",
    likesCount: 110,
    thumbnailUrl: "https://img.youtube.com/vi/YMK86f4aEr8/mqdefault.jpg"
  },
  {
    id: 'vid-26',
    youtubeId: '0RQXxX1J79I',
    title: "Going to Bethlehem| The Canticles | TELC Arulnathar Lutheran Church | 07 Dec 2025",
    artist: "The Canticles",
    category: 'Vocal',
    duration: '03:25',
    views: '1.2K',
    publishedAt: '6 months ago',
    description: "A delightful live vocal arrangement of 'Going to Bethlehem' performed live by The Canticles in Chennai.",
    likesCount: 84,
    thumbnailUrl: "https://img.youtube.com/vi/0RQXxX1J79I/mqdefault.jpg"
  },
  {
    id: 'vid-27',
    youtubeId: 'snDANwKkxcI',
    title: "WA Mozart - Exsultate Jubilate, Mv. 1, performed by Cathlin Esther | The Chromatics",
    artist: "Cathlin Esther & The Chromatics",
    category: 'Vocal',
    duration: '04:50',
    views: '2.8K',
    publishedAt: '2 months ago',
    description: "A flawless, brilliant rendition of Mozart's Exsultate Jubilate, Movement 1, performed by soprano Cathlin Esther with The Chromatics.",
    likesCount: 195,
    thumbnailUrl: "https://img.youtube.com/vi/snDANwKkxcI/mqdefault.jpg"
  },
  {
    id: 'vid-28',
    youtubeId: '2jF3Eblj2SA',
    title: "Count Your Blessings (Live) | 3 Part Harmony | Christian Hymn | 01 Feb 2026",
    artist: "3 Part Harmony",
    category: 'Vocal',
    duration: '03:40',
    views: '1.1K',
    publishedAt: '4 weeks ago',
    description: "A stunningly warm and precise 3-part vocal harmony performance of 'Count Your Blessings', live in Chennai.",
    likesCount: 78,
    thumbnailUrl: "https://img.youtube.com/vi/2jF3Eblj2SA/mqdefault.jpg"
  },
  {
    id: 'vid-29',
    youtubeId: '0LIZF3X_NDo',
    title: "Go, Baffled Coward, Go | GF Handel - Samson | Ebenezer ArunKumar | Regis Tony | Jeremiah Christopher",
    artist: "Regis Tony, Ebenezer ArunKumar & Jeremiah Christopher",
    category: 'Vocal',
    duration: '04:12',
    views: '1.4K',
    publishedAt: '1 month ago',
    description: "Handel's magnificent Samson duet 'Go, Baffled Coward, Go', featuring superb live vocal performances accompanied by keyboard.",
    likesCount: 92,
    thumbnailUrl: "https://img.youtube.com/vi/0LIZF3X_NDo/mqdefault.jpg"
  },
  {
    id: 'vid-30',
    youtubeId: 'LfrK4o-pSwU',
    title: "Appalachian Spring Excerpt | Copland | South Asian Symphony Orchestra | Alvin Arumugam | 24 May 2026",
    artist: "SASO & Alvin Arumugam",
    category: 'Instrumental',
    duration: '06:45',
    views: '3.2K',
    publishedAt: '1 month ago',
    description: "A beautiful and expressive live performance of Aaron Copland's masterpiece Appalachian Spring by the South Asian Symphony Orchestra.",
    likesCount: 204,
    thumbnailUrl: "https://img.youtube.com/vi/LfrK4o-pSwU/mqdefault.jpg"
  },
  {
    id: 'vid-31',
    youtubeId: 'mfbJu3HQJOA',
    title: "Saint-Saëns: The Swan - Masterpiece of Romanticism | by Raman Ramakrishnan & Stephen Prutsman",
    artist: "Raman Ramakrishnan & Stephen Prutsman",
    category: 'Instrumental',
    duration: '03:15',
    views: '2.4K',
    publishedAt: '3 months ago',
    description: "The elegant, famous 'The Swan' by Camille Saint-Saëns, performed live by cellist Raman Ramakrishnan and pianist Stephen Prutsman.",
    likesCount: 156,
    thumbnailUrl: "https://img.youtube.com/vi/mfbJu3HQJOA/mqdefault.jpg"
  },
  {
    id: 'vid-32',
    youtubeId: '3-bC6U7gN0E',
    title: "Beethoven - Cello Sonata No. 4 in C Major, Op. 102, No. 1 by Raman Ramakrishnan & Stephen Prutsman",
    artist: "Raman Ramakrishnan & Stephen Prutsman",
    category: 'Instrumental',
    duration: '14:20',
    views: '1.9K',
    publishedAt: '4 months ago',
    description: "Beethoven's intricate and beautiful Cello Sonata No. 4, performed live in an intimate chamber setting in Chennai.",
    likesCount: 118,
    thumbnailUrl: "https://img.youtube.com/vi/3-bC6U7gN0E/mqdefault.jpg"
  },
  {
    id: 'vid-33',
    youtubeId: 'GqJklOeZaEc',
    title: "Autumn Leaves | Johnny Mercer | The English Brass Collective",
    artist: "The English Brass Collective",
    category: 'Instrumental',
    duration: '03:10',
    views: '1.3K',
    publishedAt: '2 months ago',
    description: "A rich brass arrangement of Johnny Mercer's Autumn Leaves performed live with gorgeous warm resonance.",
    likesCount: 85,
    thumbnailUrl: "https://img.youtube.com/vi/GqJklOeZaEc/mqdefault.jpg"
  },
  {
    id: 'vid-34',
    youtubeId: '72g8yxnCK84',
    title: "God Will Take Care of You | Piano Cover | 4 Hands | TELC Arulnathar Lutheran Church | 01Feb 2026",
    artist: "Four Hands Piano Duo",
    category: 'Instrumental',
    duration: '04:05',
    views: '1.1K',
    publishedAt: '3 weeks ago',
    description: "A beautiful four-hands piano duet of 'God Will Take Care of You', recorded live in Chennai with exceptional balance.",
    likesCount: 72,
    thumbnailUrl: "https://img.youtube.com/vi/72g8yxnCK84/mqdefault.jpg"
  },
  {
    id: 'vid-35',
    youtubeId: '-mWc17pyV78',
    title: "Mozart: Symphony No. 41 Jupiter | Alvin Arumugam l South Asian Symphony Orchestra",
    artist: "SASO & Alvin Arumugam",
    category: 'Concert',
    duration: '11:55',
    views: '4.1K',
    publishedAt: '5 months ago',
    description: "A phenomenal symphonic performance of W.A. Mozart's final symphony 'Jupiter' (No. 41) under the baton of Alvin Arumugam.",
    likesCount: 310,
    thumbnailUrl: "https://img.youtube.com/vi/-mWc17pyV78/mqdefault.jpg"
  }
];

export const PLAYLISTS_DATA: Playlist[] = [
  {
    id: 'play-2',
    title: "EMC Choir Homecoming - Jan 2026 | Kalyan Subrahmanyam",
    videoCount: 12,
    description: "The Emmanuel Methodist Church (EMC) Choir Homecoming performances under the direction of Kalyan Subrahmanyam, capturing the exquisite balance of vocal parts.",
    youtubeUrl: "https://youtube.com/playlist?list=PL6HjF0ftgoqukPMVied3OlVd0zT-Imjir&si=R3pUwznFmDBe0wSj",
    imageQuery: 'singing',
    thumbnailUrl: "https://img.youtube.com/vi/NywlHEmY8YY/mqdefault.jpg"
  },
  {
    id: 'play-3',
    title: "The Chromatics - Sacred Arias Chromatics by Haydn, Mozart, Puccini, Stradella, Mendelssohn, Verdi",
    videoCount: 6,
    description: "Curated sacred arias and classical works performed live in Chennai by the renowned vocal ensemble The Chromatics, including compositions by Verdi and Mendelssohn.",
    youtubeUrl: "https://youtube.com/playlist?list=PL6HjF0ftgoqukHKfMBYbjvIYwExv-zqCo&si=XwODzLFIC2PlbhPN",
    imageQuery: 'choir',
    thumbnailUrl: "https://img.youtube.com/vi/GrHZCVTGj1I/mqdefault.jpg"
  },
  {
    id: 'play-4',
    title: "Bishop Heber Chapel Choir ( BHC ) - Christmas Carols 2025",
    videoCount: 10,
    description: "The famous Christmas Carols services and special hymns performed live by the prestigious Bishop Heber Chapel Choir in Chennai.",
    youtubeUrl: "https://youtube.com/playlist?list=PL6HjF0ftgoqvL10ZDw8kx3OLIP6VV8T97&si=dDJXD9EuLHhi09g5",
    imageQuery: 'violin',
    thumbnailUrl: "https://img.youtube.com/vi/jiNrP52imwg/mqdefault.jpg"
  },
  {
    id: 'play-5',
    title: "Saso",
    videoCount: 14,
    description: "Magnificent symphonic orchestral and vocal programs performed by the South Asian Symphony Orchestra (SASO) live in Chennai.",
    youtubeUrl: "https://youtube.com/playlist?list=PL6HjF0ftgoqui84vnHtk_1MfaqUZKeOPf&si=gxQFBuCcuUC_9Oyr",
    imageQuery: 'concert',
    thumbnailUrl: "https://img.youtube.com/vi/kFMY76NTCs8/mqdefault.jpg"
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
