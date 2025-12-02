// ============================================
// TELEGRAM SCRAPER - CAPTION-BASED VERSION
// ============================================

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import express from 'express';
import cors from 'cors';

// ============================================
// CONFIGURATION
// ============================================
const API_ID = parseInt(process.env.API_ID, 10);
const API_HASH = process.env.API_HASH || '';
const SESSION_STRING = process.env.SESSION_STRING || ''; 
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || '@BeatAnimes';
const BOT_TOKEN = process.env.BOT_TOKEN;

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

// ============================================
// CAPTION PARSER - READS FROM CAPTIONS
// ============================================
function parseAnimeCaption(captionOrFilename) {
    // Clean up the text
    let text = captionOrFilename.replace(/\.(mp4|mkv|avi|mov|flv)$/i, '').trim();
    
    // Extract quality
    const qualityMatch = text.match(/\b(2160p|1440p|1080p|720p|480p|360p|240p)\b/i);
    const quality = qualityMatch ? qualityMatch[1].toLowerCase() : '720p';
    text = text.replace(/\b(2160p|1440p|1080p|720p|480p|360p|240p)\b/gi, '').trim();
    
    // Extract language
    let language = 'Japanese';
    const langMatch = text.match(/\b(hindi|english|japanese|tamil|telugu|malayalam|kannada|dual audio)\b/gi);
    if (langMatch) {
        const lang = langMatch[0].toLowerCase();
        if (lang.includes('hindi')) language = 'Hindi';
        else if (lang.includes('english')) language = 'English';
        else if (lang.includes('tamil')) language = 'Tamil';
        else if (lang.includes('telugu')) language = 'Telugu';
        else if (lang.includes('malayalam')) language = 'Malayalam';
        else if (lang.includes('kannada')) language = 'Kannada';
        else if (lang.includes('dual')) language = 'Dual Audio';
    }
    text = text.replace(/\b(hindi|english|japanese|tamil|telugu|malayalam|kannada|dubbed?|sub|subbed|dual audio)\b/gi, '').trim();
    text = text.replace(/\[(hindi|english|japanese|tamil|telugu|malayalam|kannada|dubbed?|sub|subbed|dual audio)\]/gi, '').trim();
    
    let title, season = 1, episode = 1;
    
    // Try different episode patterns
    // Pattern 1: S01E01 or S1E1
    const pattern1 = /^(.+?)\s+S(\d+)\s*E(\d+)/i;
    const match1 = text.match(pattern1);
    if (match1) {
        title = match1[1].trim();
        season = parseInt(match1[2]);
        episode = parseInt(match1[3]);
    } 
    // Pattern 2: Episode 01 or Ep 01 or E01
    else {
        const pattern2 = /^(.+?)(?:\s+(?:Episode|Ep|E))?\s+(\d+)$/i;
        const match2 = text.match(pattern2);
        if (match2) {
            title = match2[1].trim();
            episode = parseInt(match2[2]);
        } 
        // Pattern 3: Title - 01
        else {
            const pattern3 = /^(.+?)\s*[-–—]\s*(\d+)$/;
            const match3 = text.match(pattern3);
            if (match3) {
                title = match3[1].trim();
                episode = parseInt(match3[2]);
            } else {
                title = text.trim();
            }
        }
    }
    
    // Clean up title
    title = title.replace(/\[.*?\]/g, '').trim();
    title = title.replace(/\(.*?\)/g, '').trim();
    title = title.replace(/\s+/g, ' ').trim();
    
    // Remove common file sharing group names
    title = title.replace(/(@\w+|#\w+)/g, '').trim();
    
    return { 
        title, 
        season, 
        episode, 
        quality, 
        language, 
        rawName: captionOrFilename 
    };
}

function normalizeTitle(title) {
    return title.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

// ============================================
// TELEGRAM CHANNEL SCANNER - READS CAPTIONS
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
                    
                    // ✅ USE CAPTION if available, fallback to filename
                    const caption = message.message || '';
                    const parseSource = caption.trim() !== '' ? caption : filename;
                    
                    videoMessages.push({
                        messageId: message.id,
                        filename: filename,
                        caption: caption,
                        parseSource: parseSource,  // What we'll parse
                        fileSize: doc.size,
                        duration: duration,
                        date: message.date,
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
// VIDEO PROCESSOR - USES CAPTION PARSER
// ============================================
async function processVideos(videoMessages) {
    console.log('🔧 Processing videos...');
    
    const animeMap = new Map();
    const channelName = CHANNEL_USERNAME.replace('@', '');
    
    for (const video of videoMessages) {
        // ✅ Parse from caption/parseSource instead of filename
        const parsed = parseAnimeCaption(video.parseSource);
        const normalizedTitle = normalizeTitle(parsed.title);
        
        console.log(`📝 Parsed: "${video.parseSource}" → ${parsed.title} S${parsed.season}E${parsed.episode} (${parsed.quality} ${parsed.language})`);
        
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
            caption: video.caption,
            fileSize: video.fileSize,
            duration: video.duration,
            date: video.date,
            channelName: channelName,
            videoUrl: `${channelName}/${video.messageId}`
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
    console.log('🔍 Looking for anime:', animeId);
    
    let anime = ANIME_DATABASE.find(a => a.id === animeId);
    
    if (!anime) {
        const normalizedQuery = normalizeTitle(animeId);
        anime = ANIME_DATABASE.find(a => a.normalizedTitle === normalizedQuery);
    }
    
    if (!anime) {
        const normalizedQuery = normalizeTitle(animeId);
        anime = ANIME_DATABASE.find(a => 
            a.normalizedTitle.includes(normalizedQuery) ||
            normalizedQuery.includes(a.normalizedTitle)
        );
    }
    
    if (!anime) {
        console.error('❌ Anime not found');
        return { results: null };
    }
    
    console.log('✅ Found anime:', anime.title);
    
    const anilist = anime.anilistData;
    const episodes = [];
    
    for (const season of anime.seasons) {
        for (const ep of season.episodes) {
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

function getEpisodeInfo(episodeId) {
    console.log('🔍 Looking for episode:', episodeId);
    
    const lastIndex = episodeId.lastIndexOf('-episode-');
    
    if (lastIndex === -1) {
        console.error('❌ Invalid episode ID format:', episodeId);
        return { results: null };
    }
    
    const animeId = episodeId.substring(0, lastIndex);
    const episodeNum = parseInt(episodeId.substring(lastIndex + 9));
    
    let anime = ANIME_DATABASE.find(a => a.id === animeId);
    
    if (!anime) {
        const normalizedQuery = normalizeTitle(animeId);
        anime = ANIME_DATABASE.find(a => a.normalizedTitle === normalizedQuery);
    }
    
    if (!anime) {
        const normalizedQuery = normalizeTitle(animeId);
        anime = ANIME_DATABASE.find(a => 
            a.normalizedTitle.includes(normalizedQuery) ||
            normalizedQuery.includes(a.normalizedTitle)
        );
    }
    
    if (!anime) {
        console.error('❌ Anime not found for ID:', animeId);
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
        console.error('❌ Episode not found:', episodeNum);
        return { results: null };
    }
    
    return {
        results: {
            name: `${anime.title} - Episode ${episodeNum}`,
            variants: episodeData.variants,
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
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        animeCount: ANIME_DATABASE.length 
    });
});

app.get('/', (req, res) => {
    res.json({ 
        message: 'BeatAnimes API - Caption-based Version',
        status: 'running',
        endpoints: {
            home: '/home',
            search: '/search/:query',
            anime: '/anime/:id',
            episode: '/episode/:id',
            recent: '/recent/:page',
            trending: '/trending/:page',
            stream: '/stream/:channel/:messageId',
            debug: '/debug/anime/:id',
            ping: '/ping'
        },
        stats: {
            totalAnime: ANIME_DATABASE.length,
            totalEpisodes: ANIME_DATABASE.reduce((sum, a) => sum + a.totalEpisodes, 0)
        }
    });
});

app.get('/home', (req, res) => {
    res.json(getHomeData());
});

app.get('/search/:query', (req, res) => {
    res.json(searchAnime(req.params.query));
});

app.get('/anime/:id', (req, res) => {
    const result = getAnimeDetails(req.params.id);
    if (!result.results) {
        res.status(404).json({ 
            error: 'Anime not found',
            animeId: req.params.id
        });
        return;
    }
    res.json(result);
});

app.get('/episode/:id', (req, res) => {
    const result = getEpisodeInfo(req.params.id);
    if (!result.results) {
        res.status(404).json({ 
            error: 'Episode not found',
            episodeId: req.params.id
        });
        return;
    }
    res.json(result);
});

app.get('/recent/:page', (req, res) => {
    res.json({ results: getHomeData().results.recent });
});

app.get('/trending/:page', (req, res) => {
    res.json({ results: { trending: getHomeData().results.trending } });
});

app.get('/stream/:channel/:messageId', async (req, res) => {
    const { channel, messageId } = req.params;
    
    if (!BOT_TOKEN) {
        return res.json({
            success: false,
            telegramUrl: `https://t.me/${channel}/${messageId}`,
            message: 'Bot token not configured'
        });
    }
    
    try {
        const chatResponse = await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/getChat?chat_id=@${channel}`
        );
        const chatData = await chatResponse.json();
        
        if (!chatData.ok) {
            throw new Error('Failed to get chat info');
        }
        
        const chatId = chatData.result.id;
        
        const singleMessageResponse = await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/forwardMessage`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    from_chat_id: chatId,
                    message_id: parseInt(messageId)
                })
            }
        );
        const singleMessageData = await singleMessageResponse.json();
        
        if (!singleMessageData.ok || !singleMessageData.result.video) {
             throw new Error('Video not found');
        }
        
        const fileId = singleMessageData.result.video.file_id;
        
        const fileResponse = await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`
        );
        const fileData = await fileResponse.json();
        
        if (!fileData.ok) {
            throw new Error('Failed to get file info');
        }
        
        const filePath = fileData.result.file_path;
        const directUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
        
        res.json({
            success: true,
            videoUrl: directUrl,
            streamUrl: directUrl,
            url: directUrl
        });
        
    } catch (error) {
        console.error('❌ Stream error:', error);
        res.status(500).json({ 
            success: false,
            telegramUrl: `https://t.me/${channel}/${messageId}`,
            message: error.message
        });
    }
});

app.get('/debug/anime/:id', (req, res) => {
    const animeId = req.params.id;
    
    let anime = ANIME_DATABASE.find(a => a.id === animeId);
    
    if (!anime) {
        const normalizedQuery = normalizeTitle(animeId);
        anime = ANIME_DATABASE.find(a => a.normalizedTitle === normalizedQuery);
    }
    
    if (!anime) {
        res.json({
            error: 'Anime not found',
            searchedId: animeId,
            availableIds: ANIME_DATABASE.slice(0, 20).map(a => ({
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
                qualities: [...new Set(ep.variants.map(v => v.quality))],
                firstVariant: ep.variants[0]
            }))
        )
    });
});

// ============================================
// MAIN STARTUP
// ============================================
async function startServer() {
    console.log('🚀 Starting Telegram Scraper (Caption-based)...\n');
    
    try {
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log(`✅ API server running on port ${PORT}\n`);
        });

        if (!SESSION_STRING) {
            console.log('⚠️ SESSION_STRING is missing. Running in API-only mode.');
            return; 
        }

        console.log('📱 Connecting to Telegram...');
        await client.connect();
        console.log('✅ Telegram connected!\n');
        
        const videos = await scanTelegramChannel();
        ANIME_DATABASE = await processVideos(videos);
        
        console.log('\n' + '═'.repeat(60));
        console.log('📊 DATABASE READY');
        console.log('═'.repeat(60));
        console.log(`📺 Total Anime: ${ANIME_DATABASE.length}`);
        console.log(`🎬 Total Episodes: ${ANIME_DATABASE.reduce((sum, a) => sum + a.totalEpisodes, 0)}`);
        console.log('═'.repeat(60) + '\n');
        
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
    }
}

startServer();
