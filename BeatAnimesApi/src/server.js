// BeatAnimesApi/src/server.js - FIXED VERSION WITH MOVIE/OVA SUPPORT

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

if (!API_ID || isNaN(API_ID)) {
    console.error('❌ API_ID must be a valid integer');
    process.exit(1);
}

if (!API_HASH) {
    console.error('❌ API_HASH is required');
    process.exit(1);
}

console.log(`✅ Configuration loaded:`);
console.log(`   API_ID: ${API_ID}`);
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
// HELPER FUNCTIONS
// ============================================
function normalizeTitle(title) {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

async function scanTelegramChannel() {
    console.log('📡 Scanning Telegram channel...');
    
    const videos = [];
    
    try {
        const channel = await client.getEntity(CHANNEL_USERNAME);
        console.log(`✅ Found channel: ${channel.title || CHANNEL_USERNAME}`);
        
        const messages = await client.getMessages(channel, {
            limit: 500
        });
        
        console.log(`📬 Found ${messages.length} messages`);
        
        let lastTextMessage = null;
        
        for (const message of messages) {
            if (message.message && !message.video && !message.document) {
                lastTextMessage = message.message;
                continue;
            }
            
            if (message.video || (message.document && message.document.mimeType?.startsWith('video/'))) {
                const video = message.video || message.document;
                
                let filename = '';
                if (video.attributes) {
                    for (const attr of video.attributes) {
                        if (attr.fileName) {
                            filename = attr.fileName;
                            break;
                        }
                    }
                }
                
                const caption = message.message || '';
                const parseSource = caption || filename || 'Unknown';
                
                let externalUrl = null;
                if (lastTextMessage) {
                    const urlMatch = lastTextMessage.match(/(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/i);
                    if (urlMatch) {
                        externalUrl = urlMatch[1];
                    }
                }
                
                videos.push({
                    messageId: message.id,
                    filename: filename,
                    caption: caption,
                    parseSource: parseSource,
                    externalUrl: externalUrl,
                    fileSize: video.size || 0,
                    duration: video.attributes?.find(a => a.duration)?.duration || 0,
                    date: message.date
                });
                
                lastTextMessage = null;
            }
        }
        
        console.log(`🎬 Found ${videos.length} videos`);
        return videos;
        
    } catch (error) {
        console.error('❌ Channel scan error:', error.message);
        throw error;
    }
}

// ============================================
// FIXED: Enhanced Caption Parser - Support Movies/OVA/Specials
// ============================================

function parseAnimeCaption(captionOrFilename) {
    const originalText = captionOrFilename;
    
    let directUrl = null;
    
    const urlPatterns = [
        /(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/i,
        /[\[\(](https?:\/\/[^\s<>"{}|\\^`\[\]]+)[\]\)]/i,
        /(?:link|url|download|watch):\s*(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/i
    ];
    
    for (const pattern of urlPatterns) {
        const match = captionOrFilename.match(pattern);
        if (match) {
            directUrl = match[1] || match[0];
            directUrl = directUrl.trim()
                .replace(/[,;.\s]+$/, '')
                .replace(/^["'\s]+|["'\s]+$/g, '');
            
            console.log(`✅ Extracted URL: "${directUrl}"`);
            
            captionOrFilename = captionOrFilename.replace(match[0], '').trim();
            break;
        }
    }
    
    console.log(`\n🔍 PARSING: "${originalText}"`);
    if (directUrl) {
        console.log(`   📎 Found URL: "${directUrl}"`);
    }
    
    let text = captionOrFilename.replace(/\.(mp4|mkv|avi|mov|flv)$/i, '').trim();
    console.log(`   Step 1 (remove extension): "${text}"`);
    
    const qualityMatch = text.match(/\b(2160p|1440p|1080p|720p|480p|360p|240p)\b/i);
    const quality = qualityMatch ? qualityMatch[1].toLowerCase() : '720p';
    text = text.replace(/\b(2160p|1440p|1080p|720p|480p|360p|240p)\b/gi, '').trim();
    console.log(`   Step 2 (remove quality ${quality}): "${text}"`);
    
    text = text.replace(/[\[\(](2160p|1440p|1080p|720p|480p|360p|240p)[\]\)]/gi, '').trim();
    console.log(`   Step 3 (remove [quality]): "${text}"`);
    
    let language = 'Hindi';
    const langMatch = text.match(/\b(hindi|english|japanese|tamil|telugu|malayalam|kannada|dual audio)\b/gi);
    if (langMatch) {
        const lang = langMatch[0].toLowerCase();
        if (lang.includes('hindi')) language = 'Japanese';
        else if (lang.includes('english')) language = 'English';
        else if (lang.includes('tamil')) language = 'Tamil';
        else if (lang.includes('telugu')) language = 'Telugu';
        else if (lang.includes('malayalam')) language = 'Malayalam';
        else if (lang.includes('kannada')) language = 'Kannada';
        else if (lang.includes('dual')) language = 'Dual Audio';
    }
    text = text.replace(/\b(hindi|english|japanese|tamil|telugu|malayalam|kannada|dubbed?|dub|sub|subbed|dual audio|audio)\b/gi, '').trim();
    text = text.replace(/[\[\(](hindi|english|japanese|tamil|telugu|malayalam|kannada|dubbed?|dub|sub|subbed|dual audio|audio)[\]\)]/gi, '').trim();
    console.log(`   Step 4 (remove language ${language}): "${text}"`);
    
    text = text.replace(/\b(HD|HEVC|x264|x265|AAC|AC3|BluRay|WEB-DL|WEBRip|HDRip)\b/gi, '').trim();
    text = text.replace(/[\[\(](HD|HEVC|x264|x265|AAC|AC3|BluRay|WEB-DL|WEBRip|HDRip)[\]\)]/gi, '').trim();
    console.log(`   Step 5 (remove format tags): "${text}"`);
    
    text = text.replace(/\b\d+(\.\d+)?\s*(MB|GB|KB)\b/gi, '').trim();
    text = text.replace(/(@\w+|#\w+)/g, '').trim();
    text = text.replace(/[\[\(]@\w+[\]\)]/g, '').trim();
    console.log(`   Step 6 (remove tags): "${text}"`);
    
    // ✅ NEW: Check for content type keywords
    const contentTypeMatch = text.match(/\b(movie|ova|ona|special|recap)\b/i);
    let contentType = 'EPISODE';
    if (contentTypeMatch) {
        contentType = contentTypeMatch[1].toUpperCase();
        text = text.replace(/\b(movie|ova|ona|special|recap)\b/gi, '').trim();
        console.log(`   ✅ Detected content type: ${contentType}`);
    }
    
    let title, season = 1, episode = 1;
    
    // ✅ Pattern 1: S##E## format
    const pattern1 = /^(.+?)\s+S(\d+)\s*E[p]?(\d+)/i;
    const match1 = text.match(pattern1);
    if (match1) {
        title = match1[1].trim();
        season = parseInt(match1[2]);
        episode = parseInt(match1[3]);
        console.log(`✅ Matched S##E##: Title="${title}" S${season}E${episode}`);
    } else {
        text = text.replace(/\s*[\[\(]\d+p[\]\)]$/i, '').trim();
        
        // ✅ Pattern 2: Episode ## format
        const pattern2 = /^(.+?)(?:\s+(?:Episode|Ep|E))?\s+(\d+)$/i;
        const match2 = text.match(pattern2);
        if (match2) {
            title = match2[1].trim();
            episode = parseInt(match2[2]);
            console.log(`✅ Matched Episode ##: Title="${title}" E${episode}`);
        } else {
            // ✅ Pattern 3: Title-## format
            const pattern3 = /^(.+?)\s*[-–—]\s*(\d+)$/;
            const match3 = text.match(pattern3);
            if (match3) {
                title = match3[1].trim();
                episode = parseInt(match3[2]);
                console.log(`✅ Matched Title-##: Title="${title}" E${episode}`);
            } else {
                // ✅ NEW: If it's a movie/OVA/special, use full text as title
                title = text.trim();
                
                // For movies, set episode to 0 to indicate standalone content
                if (contentType === 'MOVIE' || contentType === 'OVA' || contentType === 'SPECIAL') {
                    episode = 0;
                    console.log(`✅ ${contentType} detected: Title="${title}"`);
                } else {
                    console.log(`⚠️ No pattern matched, using full text: "${title}"`);
                }
            }
        }
    }
    
    title = title.replace(/[\[\(][^\[\]\(\)]*[\]\)]/g, '').trim();
    title = title.replace(/\s+/g, ' ').trim();
    title = title.replace(/[-_\s]+$/g, '').trim();
    title = title.replace(/^[-_\s]+/g, '').trim();
    
    console.log(`   ✅ FINAL: Title="${title}" | Type=${contentType} | S${season}E${episode} | ${quality} | ${language} | URL=${directUrl || 'None'}\n`);
    
    return { 
        title, 
        season, 
        episode, 
        quality, 
        language, 
        directUrl,
        rawName: originalText,
        contentType  // ✅ NEW: Track content type
    };
}

// ============================================
// VIDEO PROCESSOR - ENHANCED FOR MOVIES/OVA
// ============================================
async function processVideos(videoMessages) {
    console.log('🔧 Processing videos...');
    
    const animeMap = new Map();
    const channelName = CHANNEL_USERNAME.replace('@', '');
    
    for (const video of videoMessages) {
        const parsed = parseAnimeCaption(video.parseSource);
        const normalizedTitle = normalizeTitle(parsed.title);
        
        console.log(`📝 Raw: "${video.parseSource}"`);
        console.log(`   → Title: "${parsed.title}"`);
        console.log(`   → Type: ${parsed.contentType}`);
        console.log(`   → Normalized: "${normalizedTitle}"`);
        console.log(`   → S${parsed.season}E${parsed.episode} | ${parsed.quality} | ${parsed.language}`);
        console.log(`   → Direct URL: ${parsed.directUrl || 'None'}`);
        console.log('---');
        
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
                seasons: new Map(),
                contentType: parsed.contentType  // ✅ NEW
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
        
        const finalDirectUrl = video.externalUrl || parsed.directUrl;
        
        episode.variants.push({
            quality: parsed.quality,
            language: parsed.language,
            messageId: video.messageId,
            filename: video.filename,
            caption: video.caption,
            directUrl: finalDirectUrl,
            fileSize: video.fileSize,
            duration: video.duration,
            date: video.date,
            channelName: channelName,
            videoUrl: finalDirectUrl || `${channelName}/${video.messageId}`,
            contentType: parsed.contentType  // ✅ NEW
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
        banner: anilist?.banner || anilist?.image,  // ✅ NEW: Include banner
        bannerImage: anilist?.banner,                // ✅ NEW: Explicit banner
        coverImage: anilist?.image,                  // ✅ NEW: Explicit cover
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
            // ✅ Handle both episodes and movies/OVA
            if (ep.episode === 0) {
                // It's a movie/OVA/special
                episodes.push([
                    "Movie",
                    `${anime.id}-episode-0`
                ]);
            } else {
                episodes.push([
                    ep.episode.toString(),
                    `${anime.id}-episode-${ep.episode}`
                ]);
            }
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
    
    // ✅ Handle movie/OVA naming
    let displayName = episodeNum === 0 
        ? `${anime.title} - Movie` 
        : `${anime.title} - Episode ${episodeNum}`;
    
    return {
        results: {
            name: displayName,
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
        animeCount: ANIME_DATABASE.length,
        totalEpisodes: ANIME_DATABASE.reduce((sum, a) => sum + a.totalEpisodes, 0)
    });
});

app.post('/refresh', async (req, res) => {
    console.log('📡 Manual refresh requested');
    
    if (!SESSION_STRING) {
        res.status(503).json({
            success: false,
            message: 'Telegram not connected'
        });
        return;
    }
    
    const success = await refreshDatabase();
    
    res.json({
        success: success,
        animeCount: ANIME_DATABASE.length,
        totalEpisodes: ANIME_DATABASE.reduce((sum, a) => sum + a.totalEpisodes, 0),
        timestamp: new Date().toISOString()
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
// Fixed /stream endpoint with better error handling

app.get('/stream/:channel/:messageId', async (req, res) => {
    const { channel, messageId } = req.params;
    
    console.log(`🎬 Stream request: ${channel}/${messageId}`);
    
    // ✅ Method 1: Try using Telegram Client (if connected)
    if (client && SESSION_STRING) {
        try {
            console.log('📡 Attempting to get file using Telegram Client...');
            
            const channelEntity = await client.getEntity(`@${channel}`);
            const messages = await client.getMessages(channelEntity, {
                ids: [parseInt(messageId)]
            });
            
            if (messages && messages.length > 0 && messages[0].video) {
                const message = messages[0];
                const video = message.video;
                
                // Download the file to buffer (for small files < 200MB)
                if (video.size < 200 * 1024 * 1024) { // 200MB limit
                    console.log('⬇️ Downloading file...');
                    const buffer = await client.downloadMedia(message, { workers: 1 });
                    
                    if (buffer) {
                        console.log('✅ File downloaded, sending stream...');
                        res.setHeader('Content-Type', 'video/mp4');
                        res.setHeader('Content-Length', buffer.length);
                        res.setHeader('Accept-Ranges', 'bytes');
                        res.send(buffer);
                        return;
                    }
                }
            }
        } catch (error) {
            console.error('❌ Telegram Client streaming failed:', error.message);
        }
    }
    
    // ✅ Method 2: Try Bot API (if bot token available)
    if (BOT_TOKEN) {
        try {
            console.log('🤖 Attempting to get file using Bot API...');
            
            // Get chat info
            const chatResponse = await fetch(
                `https://api.telegram.org/bot${BOT_TOKEN}/getChat?chat_id=@${channel}`
            );
            const chatData = await chatResponse.json();
            
            if (!chatData.ok) {
                throw new Error('Chat not found');
            }
            
            const chatId = chatData.result.id;
            
            // Forward message to get file info
            const forwardResponse = await fetch(
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
            const forwardData = await forwardResponse.json();
            
            if (!forwardData.ok) {
                throw new Error('Message not found');
            }
            
            let fileId = null;
            if (forwardData.result.video) {
                fileId = forwardData.result.video.file_id;
            } else if (forwardData.result.document) {
                fileId = forwardData.result.document.file_id;
            }
            
            if (!fileId) {
                throw new Error('No video found in message');
            }
            
            // Get file path
            const fileResponse = await fetch(
                `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`
            );
            const fileData = await fileResponse.json();
            
            if (!fileData.ok) {
                throw new Error('Failed to get file info');
            }
            
            const filePath = fileData.result.file_path;
            const directUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
            
            console.log('✅ Got Bot API URL:', directUrl);
            
            // ✅ IMPORTANT: Proxy the video through our server
            const videoResponse = await fetch(directUrl);
            
            if (!videoResponse.ok) {
                throw new Error('Failed to fetch video');
            }
            
            // Stream the video
            res.setHeader('Content-Type', videoResponse.headers.get('content-type') || 'video/mp4');
            const contentLength = videoResponse.headers.get('content-length');
            if (contentLength) {
                res.setHeader('Content-Length', contentLength);
            }
            res.setHeader('Accept-Ranges', 'bytes');
            
            // Pipe the video stream
            const videoStream = videoResponse.body;
            for await (const chunk of videoStream) {
                res.write(chunk);
            }
            res.end();
            return;
            
        } catch (error) {
            console.error('❌ Bot API streaming failed:', error.message);
        }
    }
    
    // ✅ Method 3: Fallback - Return Telegram web link
    console.log('⚠️ All streaming methods failed, returning Telegram link');
    res.json({
        success: false,
        telegramUrl: `https://t.me/${channel}/${messageId}`,
        message: 'Direct streaming not available. Please open in Telegram.',
        error: 'STREAMING_UNAVAILABLE'
    });
});

// ✅ NEW: Test endpoint to verify bot token
app.get('/test/bot-token', async (req, res) => {
    if (!BOT_TOKEN) {
        return res.json({
            configured: false,
            message: 'BOT_TOKEN environment variable not set'
        });
    }
    
    try {
        const response = await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/getMe`
        );
        const data = await response.json();
        
        if (data.ok) {
            res.json({
                configured: true,
                botUsername: data.result.username,
                botName: data.result.first_name,
                canStream: true
            });
        } else {
            res.json({
                configured: false,
                error: data.description,
                message: 'Bot token is invalid'
            });
        }
    } catch (error) {
        res.json({
            configured: false,
            error: error.message,
            message: 'Failed to verify bot token'
        });
    }
});

// ✅ NEW: Direct stream endpoint (bypass frontend, test directly)
app.get('/direct-stream/:channel/:messageId', async (req, res) => {
    const { channel, messageId } = req.params;
    
    if (!BOT_TOKEN) {
        return res.status(500).send('Bot token not configured');
    }
    
    try {
        // Get file URL
        const chatResponse = await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/getChat?chat_id=@${channel}`
        );
        const chatData = await chatResponse.json();
        const chatId = chatData.result.id;
        
        const forwardResponse = await fetch(
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
        const forwardData = await forwardResponse.json();
        
        const fileId = forwardData.result.video?.file_id || forwardData.result.document?.file_id;
        
        const fileResponse = await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`
        );
        const fileData = await fileResponse.json();
        
        const directUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileData.result.file_path}`;
        
        // Redirect to Telegram's CDN
        res.redirect(directUrl);
        
    } catch (error) {
        console.error('Direct stream error:', error);
        res.status(500).send('Failed to get stream URL');
    }
});

// ============================================
// MAIN STARTUP
// ============================================
async function startServer() {
    console.log('🚀 Starting Telegram Scraper...\n');
    
    try {
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log(`✅ API server running on port ${PORT}\n`);
        });

        if (!SESSION_STRING) {
            console.log('⚠️ SESSION_STRING missing. API-only mode.');
            return; 
        }

        console.log('📱 Connecting to Telegram...');
        await client.connect();
        console.log('✅ Telegram connected!\n');
        
        await refreshDatabase();
        
        setInterval(async () => {
            await refreshDatabase();
        }, 10 * 60 * 1000);
        
    } catch (error) {
        console.error('❌ Startup error:', error);
        console.error('Stack:', error.stack);
    }
}

async function refreshDatabase() {
    console.log('🔄 Refreshing database...');
    try {
        const videos = await scanTelegramChannel();
        ANIME_DATABASE = await processVideos(videos);
        
        console.log('\n' + '═'.repeat(60));
        console.log('📊 DATABASE UPDATED');
        console.log('═'.repeat(60));
        console.log(`📺 Total Anime: ${ANIME_DATABASE.length}`);
        console.log(`🎬 Total Episodes: ${ANIME_DATABASE.reduce((sum, a) => sum + a.totalEpisodes, 0)}`);
        console.log(`⏰ Last Updated: ${new Date().toLocaleString()}`);
        console.log('═'.repeat(60) + '\n');
        
        return true;
    } catch (error) {
        console.error('❌ Refresh failed:', error.message);
        return false;
    }
}

startServer();

