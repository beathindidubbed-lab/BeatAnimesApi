// ============================================
// TELEGRAM ANIME SCRAPER FOR BEATANIMES
// Replace your entire BeatAnimesApi with this file
// ============================================

import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import input from "input";
import express from 'express';
import cors from 'cors';

// ============================================
// CONFIGURATION - UPDATE THESE!
// ============================================
const API_ID = 21707624;
const API_HASH = '84647ccc68eae30713d82b2f134ab23c';
const STRING_SESSION = process.env.STRING_SESSION || ''; 
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || '@BeatAnimes';

// ============================================
// DATABASE
// ============================================
let ANIME_DATABASE = [];
let ANILIST_CACHE = {};

// ============================================
// TELEGRAM CLIENT SETUP
// ============================================
const stringSession = new StringSession(STRING_SESSION);
const client = new TelegramClient(stringSession, API_ID, API_HASH, {
  connectionRetries: 5,
});

// ============================================
// ANILIST API INTEGRATION
// ============================================

async function searchAnilist(animeName) {
  const cacheKey = animeName.toLowerCase().trim();
  if (ANILIST_CACHE[cacheKey]) {
    console.log(`📦 Using cached Anilist data for: ${animeName}`);
    return ANILIST_CACHE[cacheKey];
  }

  console.log(`🔍 Searching Anilist for: ${animeName}`);
  
  const query = `
    query ($search: String) {
      Media(search: $search, type: ANIME) {
        id
        title {
          romaji
          english
          native
        }
        coverImage {
          large
          medium
        }
        bannerImage
        description
        genres
        averageScore
        status
        episodes
        season
        seasonYear
        format
      }
    }
  `;

  try {
    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        query: query,
        variables: { search: animeName }
      })
    });

    const data = await response.json();
    
    if (data.data && data.data.Media) {
      const anime = data.data.Media;
      
      ANILIST_CACHE[cacheKey] = {
        title: anime.title.english || anime.title.romaji,
        titleRomaji: anime.title.romaji,
        titleNative: anime.title.native,
        image: anime.coverImage.large,
        banner: anime.bannerImage,
        description: anime.description?.replace(/<[^>]*>/g, '') || 'No description available',
        genres: anime.genres || [],
        score: anime.averageScore,
        status: anime.status,
        totalEpisodes: anime.episodes,
        season: anime.season,
        year: anime.seasonYear,
        format: anime.format || 'TV'
      };
      
      console.log(`✅ Found on Anilist: ${ANILIST_CACHE[cacheKey].title}`);
      return ANILIST_CACHE[cacheKey];
    }
    
    return null;
  } catch (error) {
    console.error(`❌ Anilist API error for ${animeName}:`, error.message);
    return null;
  }
}

// ============================================
// FILENAME PARSER
// ============================================

function parseAnimeFilename(filename) {
  console.log('🔍 Parsing:', filename);
  
  let name = filename.replace(/\.(mp4|mkv|avi|mov|flv)$/i, '');
  
  const qualityMatch = name.match(/\b(2160p|1440p|1080p|720p|480p|360p|240p)\b/i);
  const quality = qualityMatch ? qualityMatch[1].toLowerCase() : '720p';
  
  name = name.replace(/\b(2160p|1440p|1080p|720p|480p|360p|240p)\b/gi, '').trim();
  
  const languagePatterns = [
    /\b(hindi|english|japanese|tamil|telugu|malayalam|kannada|dubbed?|sub|subbed)\b/gi,
    /\[(hindi|english|japanese|tamil|telugu|malayalam|kannada|dubbed?|sub|subbed)\]/gi
  ];
  
  let language = 'Japanese';
  for (const pattern of languagePatterns) {
    const langMatch = name.match(pattern);
    if (langMatch) {
      let detectedLang = langMatch[0].replace(/[\[\]]/g, '').trim().toLowerCase();
      
      if (detectedLang.includes('hindi')) language = 'Hindi';
      else if (detectedLang.includes('english') || detectedLang.includes('dub')) language = 'English';
      else if (detectedLang.includes('tamil')) language = 'Tamil';
      else if (detectedLang.includes('telugu')) language = 'Telugu';
      else if (detectedLang.includes('malayalam')) language = 'Malayalam';
      else if (detectedLang.includes('kannada')) language = 'Kannada';
      else if (detectedLang.includes('jap') || detectedLang.includes('sub')) language = 'Japanese';
      
      break;
    }
  }
  
  name = name.replace(/\b(hindi|english|japanese|tamil|telugu|malayalam|kannada|dubbed?|sub|subbed)\b/gi, '').trim();
  name = name.replace(/\[(hindi|english|japanese|tamil|telugu|malayalam|kannada|dubbed?|sub|subbed)\]/gi, '').trim();
  
  let title, season = 1, episode = 1;
  
  const pattern1 = /^(.+?)\s+S(\d+)E(\d+)/i;
  const match1 = name.match(pattern1);
  if (match1) {
    title = match1[1].trim();
    season = parseInt(match1[2]);
    episode = parseInt(match1[3]);
  } else {
    const pattern2 = /^(.+?)(?:\s+(?:Episode|Ep|E))?\s+(\d+)$/i;
    const match2 = name.match(pattern2);
    if (match2) {
      title = match2[1].trim();
      episode = parseInt(match2[2]);
    } else {
      const pattern3 = /^\[.+?\]\s*(.+?)\s*-\s*(\d+)/i;
      const match3 = name.match(pattern3);
      if (match3) {
        title = match3[1].trim();
        episode = parseInt(match3[2]);
      } else {
        const pattern4 = /^(.+?)\s*-\s*(\d+)/;
        const match4 = name.match(pattern4);
        if (match4) {
          title = match4[1].trim();
          episode = parseInt(match4[2]);
        } else {
          title = name.trim();
        }
      }
    }
  }
  
  title = title.replace(/\[.*?\]/g, '').trim();
  title = title.replace(/\s+/g, ' ').trim();
  
  console.log(`✅ Parsed: ${title} S${season}E${episode} [${quality}] [${language}]`);
  
  return {
    title: title,
    season: season,
    episode: episode,
    quality: quality,
    language: language,
    rawName: filename
  };
}

function normalizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================
// TELEGRAM CHANNEL SCANNER
// ============================================

async function scanTelegramChannel() {
  console.log('\n🔍 Scanning Telegram channel:', CHANNEL_USERNAME);
  
  try {
    const channel = await client.getEntity(CHANNEL_USERNAME);
    const messages = await client.getMessages(channel, { limit: 2000 });
    
    console.log(`📦 Found ${messages.length} total messages`);
    
    const videoMessages = [];
    
    for (const message of messages) {
      if (message.media && message.media.document) {
        const doc = message.media.document;
        
        const mimeType = doc.mimeType;
        if (mimeType && (mimeType.includes('video') || mimeType.includes('matroska'))) {
          const attributes = doc.attributes || [];
          let filename = 'unknown.mp4';
          let duration = 0;
          
          for (const attr of attributes) {
            if (attr.className === 'DocumentAttributeFilename') {
              filename = attr.fileName;
            }
            if (attr.className === 'DocumentAttributeVideo') {
              duration = attr.duration;
            }
          }
          
          videoMessages.push({
            messageId: message.id,
            filename: filename,
            fileSize: doc.size,
            duration: duration,
            date: message.date,
            caption: message.message || ''
          });
        }
      }
    }
    
    console.log(`✅ Found ${videoMessages.length} video messages`);
    return videoMessages;
    
  } catch (error) {
    console.error('❌ Error scanning channel:', error);
    throw error;
  }
}

// ============================================
// VIDEO PROCESSOR
// ============================================

async function processVideos(videoMessages) {
  console.log('\n🔧 Processing videos...');
  
  const animeMap = new Map();
  
  for (const video of videoMessages) {
    const parsed = parseAnimeFilename(video.filename);
    const normalizedTitle = normalizeTitle(parsed.title);
    
    if (!animeMap.has(normalizedTitle)) {
      const anilistData = await searchAnilist(parsed.title);
      
      animeMap.set(normalizedTitle, {
        id: normalizedTitle.replace(/\s+/g, '-'),
        title: parsed.title,
        normalizedTitle: normalizedTitle,
        anilistData: anilistData,
        totalEpisodes: 0,
        availableLanguages: new Set(),
        availableQualities: new Set(),
        seasons: new Map()
      });
      
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    const anime = animeMap.get(normalizedTitle);
    
    anime.availableLanguages.add(parsed.language);
    anime.availableQualities.add(parsed.quality);
    
    if (!anime.seasons.has(parsed.season)) {
      anime.seasons.set(parsed.season, {
        season: parsed.season,
        episodes: new Map()
      });
    }
    
    const season = anime.seasons.get(parsed.season);
    
    if (!season.episodes.has(parsed.episode)) {
      season.episodes.set(parsed.episode, {
        episode: parsed.episode,
        variants: []
      });
      anime.totalEpisodes++;
    }
    
    const episode = season.episodes.get(parsed.episode);
    
    episode.variants.push({
      quality: parsed.quality,
      language: parsed.language,
      messageId: video.messageId,
      filename: video.filename,
      fileSize: video.fileSize,
      duration: video.duration,
      date: video.date,
      videoUrl: `${CHANNEL_USERNAME}/${video.messageId}`
    });
  }
  
  const animeList = Array.from(animeMap.values()).map(anime => {
    const seasons = Array.from(anime.seasons.values()).map(season => {
      const episodes = Array.from(season.episodes.values()).map(ep => {
        ep.variants.sort((a, b) => {
          const qualityOrder = { '1080p': 0, '720p': 1, '480p': 2, '360p': 3 };
          return (qualityOrder[a.quality] || 99) - (qualityOrder[b.quality] || 99);
        });
        return ep;
      });
      
      episodes.sort((a, b) => a.episode - b.episode);
      season.episodes = episodes;
      return season;
    });
    
    seasons.sort((a, b) => a.season - b.season);
    
    return {
      ...anime,
      seasons: seasons,
      availableLanguages: Array.from(anime.availableLanguages),
      availableQualities: Array.from(anime.availableQualities).sort((a, b) => {
        const qualityOrder = { '1080p': 0, '720p': 1, '480p': 2, '360p': 3 };
        return (qualityOrder[a] || 99) - (qualityOrder[b] || 99);
      })
    };
  });
  
  console.log(`✅ Processed ${animeList.length} unique anime`);
  console.log(`📊 Total episodes: ${animeList.reduce((sum, a) => sum + a.totalEpisodes, 0)}`);
  
  return animeList;
}

// ============================================
// API ENDPOINTS
// ============================================

function getHomeData() {
  const sortedByRecent = [...ANIME_DATABASE].sort((a, b) => {
    const getLatestDate = (anime) => {
      let latest = 0;
      for (const season of anime.seasons) {
        for (const ep of season.episodes) {
          for (const variant of ep.variants) {
            if (variant.date > latest) latest = variant.date;
          }
        }
      }
      return latest;
    };
    return getLatestDate(b) - getLatestDate(a);
  });
  
  const trending = sortedByRecent.slice(0, 10).map(formatAnimeForList);
  const popular = [...ANIME_DATABASE]
    .sort((a, b) => b.totalEpisodes - a.totalEpisodes)
    .slice(0, 20)
    .map(formatAnimeForList);
  
  const recentEpisodes = [];
  for (const anime of ANIME_DATABASE) {
    for (const season of anime.seasons) {
      for (const episode of season.episodes) {
        const latestVariant = episode.variants[0];
        recentEpisodes.push({
          id: `${anime.id}-episode-${episode.episode}`,
          title: anime.title,
          image: anime.anilistData?.image || `https://via.placeholder.com/300x400?text=${encodeURIComponent(anime.title)}`,
          episode: episode.episode,
          releaseDate: latestVariant.date,
          languages: episode.variants.map(v => v.language).filter((v, i, a) => a.indexOf(v) === i),
          qualities: episode.variants.map(v => v.quality).filter((v, i, a) => a.indexOf(v) === i)
        });
      }
    }
  }
  
  recentEpisodes.sort((a, b) => b.releaseDate - a.releaseDate);
  
  return {
    results: {
      trending,
      popular,
      recent: recentEpisodes.slice(0, 30)
    }
  };
}

function formatAnimeForList(anime) {
  const anilist = anime.anilistData;
  return {
    id: anime.id,
    title: anime.title,
    image: anilist?.image || `https://via.placeholder.com/300x400?text=${encodeURIComponent(anime.title)}`,
    releaseDate: anilist?.year || new Date().getFullYear(),
    status: anilist?.status || 'Available',
    genres: anilist?.genres || [],
    score: anilist?.score,
    totalEpisodes: anime.totalEpisodes,
    availableLanguages: anime.availableLanguages,
    availableQualities: anime.availableQualities
  };
}

function searchAnime(query) {
  const normalizedQuery = normalizeTitle(query);
  
  const results = ANIME_DATABASE.filter(anime => {
    return anime.normalizedTitle.includes(normalizedQuery) ||
           anime.title.toLowerCase().includes(query.toLowerCase());
  });
  
  return {
    results: results.map(formatAnimeForList)
  };
}

function getAnimeDetails(animeId) {
  const anime = ANIME_DATABASE.find(a => a.id === animeId);
  
  if (!anime) {
    return { results: null };
  }
  
  const anilist = anime.anilistData;
  
  const episodes = [];
  for (const season of anime.seasons) {
    for (const ep of season.episodes) {
      episodes.push([
        `S${season.season}E${ep.episode}`,
        `${anime.id}-episode-${ep.episode}`,
        ep.variants.length
      ]);
    }
  }
  
  return {
    results: {
      source: 'telegram',
      name: anime.title,
      image: anilist?.image || `https://via.placeholder.com/300x400?text=${encodeURIComponent(anime.title)}`,
      banner: anilist?.banner,
      plot_summary: anilist?.description || `Watch ${anime.title} in multiple languages and qualities`,
      other_name: anilist?.titleRomaji || anime.title,
      released: anilist?.year || new Date().getFullYear(),
      status: anilist?.status || 'Available',
      type: anilist?.format || 'TV',
      genre: anilist?.genres?.join(', ') || 'Action, Adventure',
      episodes: episodes,
      availableLanguages: anime.availableLanguages,
      availableQualities: anime.availableQualities,
      totalEpisodes: anime.totalEpisodes
    }
  };
}

function getEpisodeInfo(episodeId) {
  const parts = episodeId.split('-episode-');
  const animeId = parts[0];
  const episodeNum = parseInt(parts[1]);
  
  const anime = ANIME_DATABASE.find(a => a.id === animeId);
  if (!anime) {
    return { results: null };
  }
  
  let episodeData = null;
  for (const season of anime.seasons) {
    const ep = season.episodes.find(e => e.episode === episodeNum);
    if (ep) {
      episodeData = ep;
      break;
    }
  }
  
  if (!episodeData) {
    return { results: null };
  }
  
  const variantsByLanguage = {};
  for (const variant of episodeData.variants) {
    if (!variantsByLanguage[variant.language]) {
      variantsByLanguage[variant.language] = [];
    }
    variantsByLanguage[variant.language].push(variant);
  }
  
  return {
    results: {
      name: `${anime.title} - Episode ${episodeNum}`,
      variants: episodeData.variants,
      variantsByLanguage: variantsByLanguage,
      availableLanguages: Object.keys(variantsByLanguage),
      stream: null
    }
  };
}

// ============================================
// EXPRESS SERVER
// ============================================
const app = express();
app.use(cors());
app.use(express.json());

app.get('/ping', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/home', (req, res) => {
  res.json(getHomeData());
});

app.get('/search/:query', (req, res) => {
  res.json(searchAnime(req.params.query));
});

app.get('/anime/:id', (req, res) => {
  res.json(getAnimeDetails(req.params.id));
});

app.get('/episode/:id', (req, res) => {
  res.json(getEpisodeInfo(req.params.id));
});

app.get('/recent/:page', (req, res) => {
  const homeData = getHomeData();
  res.json({ results: homeData.results.recent });
});

app.get('/trending/:page', (req, res) => {
  const homeData = getHomeData();
  res.json({ results: { trending: homeData.results.trending } });
});

// ============================================
// MAIN STARTUP
// ============================================
async function startServer() {
  console.log('🚀 Starting Telegram Anime Scraper...\n');
  
  try {
    await client.start({
      phoneNumber: async () => await input.text('Phone number: '),
      password: async () => await input.text('Password (if 2FA): '),
      phoneCode: async () => await input.text('Code from Telegram: '),
      onError: (err) => console.error(err),
    });
    
    console.log('✅ Connected to Telegram');
    
    const sessionString = client.session.save();
    if (!STRING_SESSION) {
      console.log('\n📝 SAVE THIS SESSION STRING:');
      console.log('═'.repeat(60));
      console.log(sessionString);
      console.log('═'.repeat(60));
      console.log('\nAdd it to Render as STRING_SESSION environment variable!\n');
    }
    
    const videos = await scanTelegramChannel();
    ANIME_DATABASE = await processVideos(videos);
    
    console.log('\n' + '═'.repeat(60));
    console.log('📊 DATABASE SUMMARY');
    console.log('═'.repeat(60));
    console.log(`📺 Total Anime: ${ANIME_DATABASE.length}`);
    console.log(`🎬 Total Episodes: ${ANIME_DATABASE.reduce((sum, a) => sum + a.totalEpisodes, 0)}`);
    console.log(`🌐 Languages: ${[...new Set(ANIME_DATABASE.flatMap(a => a.availableLanguages))].join(', ')}`);
    console.log(`📹 Qualities: ${[...new Set(ANIME_DATABASE.flatMap(a => a.availableQualities))].join(', ')}`);
    console.log('═'.repeat(60) + '\n');
    
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`✅ API Server running on port ${PORT}\n`);
    });
    
    setInterval(async () => {
      console.log('\n🔄 Auto-refreshing database...');
      try {
        const videos = await scanTelegramChannel();
        ANIME_DATABASE = await processVideos(videos);
        console.log('✅ Database refreshed');
      } catch (error) {
        console.error('❌ Auto-refresh failed:', error.message);
      }
    }, 30 * 60 * 1000);
    
  } catch (error) {
    console.error('❌ Startup error:', error);
    process.exit(1);
  }
}

startServer();
