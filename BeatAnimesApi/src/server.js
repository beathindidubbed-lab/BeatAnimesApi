// ============================================
// TELEGRAM SCRAPER - FIXED FOR RENDER
// ============================================

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import express from 'express';
import cors from 'cors';

// ============================================
// CRITICAL FIX: Parse API_ID as INTEGER
// ============================================
const API_ID = parseInt(process.env.API_ID, 10);
const API_HASH = process.env.API_HASH || '';
const SESSION_STRING = process.env.SESSION_STRING || ''; 
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || '@BeatAnimes';
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const YOUR_BOT_TOKEN_HERE = process.env.YOUR_BOT_TOKEN_HERE || '';

// Validation
if (!API_ID || isNaN(API_ID)) {
    console.error('❌ API_ID must be a valid integer');
    process.exit(1);
}

if (!API_HASH) {
    console.error('❌ API_HASH is required');
    process.exit(1);
}

console.log(`✅ Configuration loaded:`);
console.log(`   API_ID: ${API_ID} (type: ${typeof API_ID})`);
console.log(`   API_HASH: ${API_HASH.substring(0, 5)}...`);
console.log(`   Session: ${SESSION_STRING ? 'Found' : 'Empty (first run)'}`);
console.log(`   Channel: ${CHANNEL_USERNAME}\n`);

// ============================================
// DATABASE
// ============================================
let ANIME_DATABASE = [];
let ANILIST_CACHE = {};

// ============================================
// TELEGRAM CLIENT
// ============================================
const client = new TelegramClient(
    new StringSession(SESSION_STRING), 
    API_ID,
    API_HASH,
    {
        connectionRetries: 5,
        useWSS: true,
    }
);

// ============================================
// ANILIST API
// ============================================
async function searchAnilist(animeName) {
    const cacheKey = animeName.toLowerCase().trim();
    if (ANILIST_CACHE[cacheKey]) {
        return ANILIST_CACHE[cacheKey];
    }

    const query = `
        query ($search: String) {
            Media(search: $search, type: ANIME) {
                id
                title { romaji english native }
                coverImage { large medium }
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
            
            return ANILIST_CACHE[cacheKey];
        }
        
        return null;
    } catch (error) {
        console.error(`Anilist error:`, error.message);
        return null;
    }
}

import requests


def get_telegram_video_url(channel_name, message_id):
    # Get the message to extract file_id
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/getChat"
    params = {"chat_id": f"@{channel_name}"}
    
    chat = requests.get(url, params=params).json()
    chat_id = chat['result']['id']
    
    # Get message content
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/getMessage"
    params = {"chat_id": chat_id, "message_ids": message_id}
    
    msg = requests.get(url, params=params).json()
    file_id = msg['result']['video']['file_id']
    
    # Get direct download link
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/getFile"
    params = {"file_id": file_id}
    
    file_info = requests.get(url, params=params).json()
    file_path = file_info['result']['file_path']
    
    direct_url = f"https://api.telegram.org/file/bot{BOT_TOKEN}/{file_path}"
    return direct_url

// ============================================
// FILENAME PARSER
// ============================================
function parseAnimeFilename(filename) {
    let name = filename.replace(/\.(mp4|mkv|avi|mov|flv)$/i, '');
    
    const qualityMatch = name.match(/\b(2160p|1440p|1080p|720p|480p|360p|240p)\b/i);
    const quality = qualityMatch ? qualityMatch[1].toLowerCase() : '720p';
    
    name = name.replace(/\b(2160p|1440p|1080p|720p|480p|360p|240p)\b/gi, '').trim();
    
    let language = 'Japanese';
    const langMatch = name.match(/\b(hindi|english|japanese|tamil|telugu|malayalam|kannada)\b/gi);
    if (langMatch) {
        const lang = langMatch[0].toLowerCase();
        if (lang.includes('hindi')) language = 'Hindi';
        else if (lang.includes('english')) language = 'English';
        else if (lang.includes('tamil')) language = 'Tamil';
        else if (lang.includes('telugu')) language = 'Telugu';
        else if (lang.includes('malayalam')) language = 'Malayalam';
        else if (lang.includes('kannada')) language = 'Kannada';
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
            title = name.trim();
        }
    }
    
    title = title.replace(/\[.*?\]/g, '').trim();
    title = title.replace(/\s+/g, ' ').trim();
    
    return { title, season, episode, quality, language, rawName: filename };
}

function normalizeTitle(title) {
    return title.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

// ============================================
// TELEGRAM CHANNEL SCANNER
// ============================================
async function scanTelegramChannel() {
    console.log('🔍 Scanning:', CHANNEL_USERNAME);
    
    try {
        const channel = await client.getEntity(CHANNEL_USERNAME);
        const messages = await client.getMessages(channel, { limit: 2000 });
        
        console.log(`📦 Found ${messages.length} messages`);
        
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
        
        console.log(`✅ Found ${videoMessages.length} videos`);
        return videoMessages;
        
    } catch (error) {
        console.error('❌ Scan error:', error);
        throw error;
    }
}

// ============================================
// VIDEO PROCESSOR
// ============================================

async function processVideos(videoMessages) {
    console.log('🔧 Processing videos...');
    
    const animeMap = new Map();
    
    // Extract channel name once (remove @ symbol)
    const channelName = CHANNEL_USERNAME.replace('@', '');
    
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
        
        // ✅ CRITICAL FIX: Separate channel name and message ID
        // Frontend can construct full URL: `https://t.me/${channelName}/${messageId}`
        episode.variants.push({
            quality: parsed.quality,
            language: parsed.language,
            messageId: video.messageId,
            filename: video.filename,
            fileSize: video.fileSize,
            duration: video.duration,
            date: video.date,
            channelName: channelName,  // Just "BeatAnimes"
            videoUrl: `${channelName}/${video.messageId}`  // "BeatAnimes/123" for compatibility
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
            availableQualities: Array.from(anime.availableQualities)
        };
    });
    
    console.log(`✅ Processed ${animeList.length} anime`);
    return animeList;
}
// ============================================
// API HELPER FUNCTIONS
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
        totalEpisodes: anime.totalEpisodes,
    };
}

function searchAnime(query) {
    const normalizedQuery = normalizeTitle(query);
    const results = ANIME_DATABASE.filter(anime => {
        return anime.normalizedTitle.includes(normalizedQuery) ||
               anime.title.toLowerCase().includes(query.toLowerCase());
    });
    return { results: results.map(formatAnimeForList) };
}

function getAnimeDetails(animeId) {
    // Try to find by ID first
    let anime = ANIME_DATABASE.find(a => a.id === animeId);
    
    // If not found by ID, try normalized title search
    if (!anime) {
        const normalizedQuery = normalizeTitle(animeId);
        anime = ANIME_DATABASE.find(a => a.normalizedTitle === normalizedQuery);
    }
    
    // If still not found, try partial match
    if (!anime) {
        const normalizedQuery = normalizeTitle(animeId);
        anime = ANIME_DATABASE.find(a => 
            a.normalizedTitle.includes(normalizedQuery) ||
            normalizedQuery.includes(a.normalizedTitle)
        );
    }
    
    if (!anime) {
        return { results: null };
    }
    
    const anilist = anime.anilistData;
    const episodes = [];
    
    for (const season of anime.seasons) {
        for (const ep of season.episodes) {
            // Format: ["episode-number", "episode-id"]
            episodes.push([
                ep.episode.toString(),
                `${anime.id}-episode-${ep.episode}`
            ]);
        }
    }
    
    return {
        results: {
            source: 'telegram',
            name: anime.title,
            image: anilist?.image || `https://via.placeholder.com/300x400?text=${encodeURIComponent(anime.title)}`,
            banner: anilist?.banner,
            plot_summary: anilist?.description || '',
            other_name: anilist?.titleRomaji || anime.title,
            released: anilist?.year || new Date().getFullYear(),
            status: anilist?.status || 'Available',
            type: anilist?.format || 'TV',
            genre: anilist?.genres?.join(', ') || 'Action',
            episodes: episodes,
            totalEpisodes: anime.totalEpisodes
        }
    };
}

// ============================================
// EPISODE INFO - FIXED VERSION
// ============================================

function getEpisodeInfo(episodeId) {
    console.log('🔍 Looking for episode:', episodeId);
    
    // Find the last occurrence of '-episode-' to split correctly
    const lastIndex = episodeId.lastIndexOf('-episode-');
    
    if (lastIndex === -1) {
        console.error('❌ Invalid episode ID format:', episodeId);
        return { results: null };
    }
    
    const animeId = episodeId.substring(0, lastIndex);
    const episodeNum = parseInt(episodeId.substring(lastIndex + 9)); // 9 = length of '-episode-'
    
    console.log('📊 Parsed:', { animeId, episodeNum });
    
    // Try to find anime by exact ID first
    let anime = ANIME_DATABASE.find(a => a.id === animeId);
    
    // If not found, try normalized title search
    if (!anime) {
        const normalizedQuery = normalizeTitle(animeId);
        anime = ANIME_DATABASE.find(a => a.normalizedTitle === normalizedQuery);
        console.log('🔄 Trying normalized search:', normalizedQuery);
    }
    
    // If still not found, try partial match
    if (!anime) {
        const normalizedQuery = normalizeTitle(animeId);
        anime = ANIME_DATABASE.find(a => 
            a.normalizedTitle.includes(normalizedQuery) ||
            normalizedQuery.includes(a.normalizedTitle)
        );
        console.log('🔄 Trying partial match');
    }
    
    if (!anime) {
        console.error('❌ Anime not found for ID:', animeId);
        console.log('📚 Available anime IDs:', ANIME_DATABASE.map(a => a.id).slice(0, 10));
        return { results: null };
    }
    
    console.log('✅ Found anime:', anime.title);
    
    // Find the episode
    let episodeData = null;
    for (const season of anime.seasons) {
        const ep = season.episodes.find(e => e.episode === episodeNum);
        if (ep) {
            episodeData = ep;
            console.log('✅ Found episode:', episodeNum);
            break;
        }
    }
    
    if (!episodeData) {
        console.error('❌ Episode not found:', episodeNum);
        console.log('📋 Available episodes:', anime.seasons[0]?.episodes.map(e => e.episode));
        return { results: null };
    }
    
    console.log('✅ Episode has', episodeData.variants.length, 'variants');
    
    return {
        results: {
            name: `${anime.title} - Episode ${episodeNum}`,
            variants: episodeData.variants,
        }
    };
}

// ============================================
// ADD BETTER ERROR HANDLING TO THE ROUTE
// ============================================

app.get('/episode/:id', (req, res) => {
    console.log('📡 /episode request:', req.params.id);
    const result = getEpisodeInfo(req.params.id);
    
    if (!result.results) {
        console.error('❌ Episode not found');
        res.status(404).json({ 
            error: 'Episode not found',
            episodeId: req.params.id,
            suggestion: 'Check if the anime and episode exist in the database'
        });
        return;
    }
    
    console.log('✅ Sending episode data');
    res.json(result);
});

// ============================================
// DEBUG ROUTE - Remove after fixing
// ============================================

app.get('/debug/anime/:id', (req, res) => {
    const animeId = req.params.id;
    
    // Find anime
    let anime = ANIME_DATABASE.find(a => a.id === animeId);
    
    if (!anime) {
        const normalizedQuery = normalizeTitle(animeId);
        anime = ANIME_DATABASE.find(a => a.normalizedTitle === normalizedQuery);
    }
    
    if (!anime) {
        res.json({
            error: 'Anime not found',
            searchedId: animeId,
            availableIds: ANIME_DATABASE.map(a => ({
                id: a.id,
                title: a.title,
                normalizedTitle: a.normalizedTitle,
                episodeCount: a.totalEpisodes
            }))
        });
        return;
    }
    
    res.json({
        anime: {
            id: anime.id,
            title: anime.title,
            normalizedTitle: anime.normalizedTitle,
            totalEpisodes: anime.totalEpisodes
        },
        episodes: anime.seasons.flatMap(season => 
            season.episodes.map(ep => ({
                episodeNumber: ep.episode,
                episodeId: `${anime.id}-episode-${ep.episode}`,
                variantCount: ep.variants.length,
                languages: [...new Set(ep.variants.map(v => v.language))],
                qualities: [...new Set(ep.variants.map(v => v.quality))]
            }))
        )
    });
});

// ============================================
// EXPRESS SERVER
// ============================================
const app = express();
app.use(cors());
app.use(express.json());

app.get('/ping', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        animeCount: ANIME_DATABASE.length 
    });
});

app.get('/', (req, res) => {
    res.json({ 
        message: 'BeatAnimes API',
        status: 'running',
        endpoints: {
            home: '/home',
            search: '/search/:query',
            anime: '/anime/:id',
            episode: '/episode/:id',
            recent: '/recent/:page',
            trending: '/trending/:page',
            ping: '/ping'
        },
        stats: {
            totalAnime: ANIME_DATABASE.length,
            totalEpisodes: ANIME_DATABASE.reduce((sum, a) => sum + a.totalEpisodes, 0)
        }
    });
});
app.get('/home', (req, res) => {
    console.log('📡 /home request');
    res.json(getHomeData());
});

app.get('/search/:query', (req, res) => {
    console.log('📡 /search request:', req.params.query);
    res.json(searchAnime(req.params.query));
});

app.get('/anime/:id', (req, res) => {
    console.log('📡 /anime request:', req.params.id);
    const result = getAnimeDetails(req.params.id);
    console.log('📤 Sending anime details:', result);
    res.json(result);
});

app.get('/episode/:id', (req, res) => {
    console.log('📡 /episode request:', req.params.id);
    res.json(getEpisodeInfo(req.params.id));
});

app.get('/recent/:page', (req, res) => {
    res.json({ results: getHomeData().results.recent });
});

app.get('/trending/:page', (req, res) => {
    res.json({ results: { trending: getHomeData().results.trending } });
});

// ============================================
// MAIN STARTUP
// ============================================
async function startServer() {
    console.log('🚀 Starting Telegram Scraper on Render...\n');
    
    try {
        // Start Express server FIRST (for Render health checks)
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log(`✅ API server running on port ${PORT}\n`);
        });

        // Then connect to Telegram
        console.log('📱 Connecting to Telegram...');
        
        if (!SESSION_STRING) {
            throw new Error('SESSION_STRING is required!');
        }

        await client.connect();
        console.log('✅ Telegram connected!\n');
        
        // Scan channel
        const videos = await scanTelegramChannel();
        ANIME_DATABASE = await processVideos(videos);
        
        console.log('\n' + '═'.repeat(60));
        console.log('📊 DATABASE READY');
        console.log('═'.repeat(60));
        console.log(`📺 Total Anime: ${ANIME_DATABASE.length}`);
        console.log(`🎬 Total Episodes: ${ANIME_DATABASE.reduce((sum, a) => sum + a.totalEpisodes, 0)}`);
        console.log('═'.repeat(60) + '\n');
        
        // Auto-refresh every 30 minutes
        setInterval(async () => {
            console.log('🔄 Refreshing database...');
            try {
                const videos = await scanTelegramChannel();
                ANIME_DATABASE = await processVideos(videos);
                console.log('✅ Database refreshed');
            } catch (error) {
                console.error('❌ Refresh failed:', error.message);
            }
        }, 30 * 60 * 1000);
        
    } catch (error) {
        console.error('❌ Startup error:', error);
        console.error('Stack:', error.stack);
        
        // Keep server alive even if Telegram fails
        if (!app.listening) {
            const PORT = process.env.PORT || 3000;
            app.listen(PORT, () => {
                console.log(`⚠️ API running in degraded mode on port ${PORT}`);
            });
        }
    }
}

startServer();




