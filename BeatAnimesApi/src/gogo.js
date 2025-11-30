// src/gogo.js - Hybrid Scraper (GogoAnimes.watch + HiAnime)
// Supports Hindi, English, Japanese with multi-source video extraction

import * as cheerio from 'cheerio';

/**
 * CONFIGURATION - Priority order for sources
 */
const SOURCES_CONFIG = {
    primary: 'hianime',     // Primary source (better catalog)
    fallback: 'gogoanimes'  // Fallback source
};

// ========================================
// HIANIME.TO SCRAPER
// ========================================

class HiAnimeExtractor {
    constructor() {
        this.baseUrl = 'https://hianime.do';
        this.ajaxUrl = 'https://hianime.do/ajax';
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://hianime.do/',
            'X-Requested-With': 'XMLHttpRequest'
        };
    }

    async fetchPage(url) {
        try {
            const response = await fetch(url, { 
                headers: this.headers,
                signal: AbortSignal.timeout(15000)
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.text();
        } catch (error) {
            console.error(`HiAnime fetch error:`, error.message);
            throw error;
        }
    }

    async fetchJson(url) {
        try {
            const response = await fetch(url, { 
                headers: this.headers,
                signal: AbortSignal.timeout(15000)
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error(`HiAnime JSON fetch error:`, error.message);
            throw error;
        }
    }

    /**
     * Get home page data (Recent, Trending, Popular)
     */
    async getHome() {
        try {
            const html = await this.fetchPage(this.baseUrl);
            const $ = cheerio.load(html);

            const recent = [];
            const trending = [];

            // Recent releases
            $('#anime-recently-updated .flw-item').slice(0, 12).each((i, el) => {
                const anime = this.parseAnimeCard($, $(el));
                if (anime) recent.push(anime);
            });

            // Trending
            $('#anime-trending .flw-item').slice(0, 12).each((i, el) => {
                const anime = this.parseAnimeCard($, $(el));
                if (anime) trending.push(anime);
            });

            console.log(`✅ HiAnime: ${recent.length} recent, ${trending.length} trending`);

            return {
                recent: recent,
                trending: trending
            };
        } catch (error) {
            console.error('HiAnime getHome error:', error);
            return { recent: [], trending: [] };
        }
    }

    /**
     * Parse anime card from HTML
     */
    parseAnimeCard($, element) {
        try {
            const title = $(element).find('.film-name a').attr('title') || 
                         $(element).find('.film-name').text().trim();
            const id = $(element).find('.film-poster a').attr('href')?.split('/')[1]?.split('?')[0];
            const image = $(element).find('.film-poster img').attr('data-src') || 
                         $(element).find('.film-poster img').attr('src');
            const episodeNum = $(element).find('.fd-infor .tick-sub, .fd-infor .tick-dub, .fd-infor .tick-eps')
                                         .first().text().trim();

            if (!id || !title) return null;

            return {
                id: id,
                title: title,
                image: image || '',
                episode: episodeNum || '',
                url: `${this.baseUrl}/${id}`
            };
        } catch (error) {
            return null;
        }
    }

    /**
     * Search anime
     */
    async searchAnime(query, page = 1) {
        try {
            const searchUrl = `${this.baseUrl}/search?keyword=${encodeURIComponent(query)}&page=${page}`;
            const html = await this.fetchPage(searchUrl);
            const $ = cheerio.load(html);

            const results = [];
            $('.flw-item').each((i, el) => {
                const anime = this.parseAnimeCard($, $(el));
                if (anime) results.push(anime);
            });

            console.log(`✅ HiAnime search: Found ${results.length} results for "${query}"`);

            return {
                results: results,
                hasNextPage: $('.pagination .page-item.active').next().length > 0
            };
        } catch (error) {
            console.error('HiAnime search error:', error);
            return { results: [], hasNextPage: false };
        }
    }

    /**
     * Get anime details with episodes
     */
    async getAnimeDetails(animeId) {
        try {
            const url = `${this.baseUrl}/${animeId}`;
            const html = await this.fetchPage(url);
            const $ = cheerio.load(html);

            const title = $('.anisc-detail h2').text().trim();
            const image = $('.film-poster img').attr('src');
            const synopsis = $('.film-description .text').text().trim();
            const type = $('.item-title:contains("Type")').next().text().trim();
            const status = $('.item-title:contains("Status")').next().text().trim();
            const genres = [];
            
            $('.item-list a[href*="/genre/"]').each((i, el) => {
                genres.push($(el).text().trim());
            });

            // Get episode list with languages
            const dataId = $('#wrapper').attr('data-id');
            const episodes = await this.getEpisodeList(dataId);

            return {
                id: animeId,
                title: title,
                image: image,
                synopsis: synopsis,
                type: type,
                status: status,
                genres: genres,
                episodes: episodes
            };
        } catch (error) {
            console.error('HiAnime getAnimeDetails error:', error);
            throw error;
        }
    }

    /**
     * Get episode list with language info
     */
    async getEpisodeList(dataId) {
        try {
            const url = `${this.ajaxUrl}/v2/episode/list/${dataId}`;
            const data = await this.fetchJson(url);
            
            if (!data.html) return [];

            const $ = cheerio.load(data.html);
            const episodes = [];

            $('.ep-item').each((i, el) => {
                const $el = $(el);
                const number = $el.attr('data-number');
                const id = $el.attr('data-id');
                const title = $el.attr('title');
                
                // Check available languages
                const languages = {
                    sub: $el.find('.badge.badge-sub').length > 0,
                    dub: $el.find('.badge.badge-dub').length > 0
                };

                episodes.push({
                    number: parseInt(number),
                    id: id,
                    title: title,
                    languages: languages
                });
            });

            console.log(`✅ Found ${episodes.length} episodes`);
            return episodes;
        } catch (error) {
            console.error('HiAnime getEpisodeList error:', error);
            return [];
        }
    }

    /**
     * Get streaming sources for episode
     */
    async getEpisodeSources(episodeId, category = 'sub') {
        try {
            // Step 1: Get server list
            const serversUrl = `${this.ajaxUrl}/v2/episode/servers?episodeId=${episodeId}`;
            const serversData = await this.fetchJson(serversUrl);
            
            if (!serversData.html) {
                throw new Error('No servers found');
            }

            const $ = cheerio.load(serversData.html);
            
            // Find server based on category (sub/dub)
            let serverId = null;
            $(`.ps_-block.ps_-block-sub .server-item`).each((i, el) => {
                const $el = $(el);
                if (category === 'sub' && $el.text().includes('Vidstreaming')) {
                    serverId = $el.attr('data-id');
                    return false;
                }
            });

            $(`.ps_-block.ps_-block-dub .server-item`).each((i, el) => {
                const $el = $(el);
                if (category === 'dub' && $el.text().includes('Vidstreaming')) {
                    serverId = $el.attr('data-id');
                    return false;
                }
            });

            if (!serverId) {
                // Fallback to first available server
                serverId = $('.server-item').first().attr('data-id');
            }

            if (!serverId) {
                throw new Error('No valid server found');
            }

            // Step 2: Get source URL
            const sourcesUrl = `${this.ajaxUrl}/v2/episode/sources?id=${serverId}`;
            const sourcesData = await this.fetchJson(sourcesUrl);

            if (!sourcesData.link) {
                throw new Error('No video source found');
            }

            // Step 3: Extract M3U8 from embed
            const videoUrl = await this.extractFromEmbed(sourcesData.link);

            return {
                sources: [
                    {
                        file: videoUrl,
                        type: 'hls',
                        label: category === 'dub' ? 'English Dub' : 'Japanese (English Sub)'
                    }
                ],
                sources_bk: [],
                servers: { hianime: sourcesData.link }
            };
        } catch (error) {
            console.error('HiAnime getEpisodeSources error:', error);
            throw error;
        }
    }

    /**
     * Extract video URL from embed page
     */
    async extractFromEmbed(embedUrl) {
        try {
            const html = await this.fetchPage(embedUrl);

            // Try to find M3U8 URL
            const patterns = [
                /file:\s*["']([^"']+\.m3u8[^"']*)["']/i,
                /source:\s*["']([^"']+\.m3u8[^"']*)["']/i,
                /sources:\s*\[.*?["']([^"']+\.m3u8[^"']*)["']/is,
            ];

            for (const pattern of patterns) {
                const match = html.match(pattern);
                if (match && match[1]) {
                    console.log('✅ Found M3U8 URL');
                    return match[1];
                }
            }

            // Fallback: return embed URL
            console.warn('⚠️ Could not extract M3U8, returning embed URL');
            return embedUrl;
        } catch (error) {
            console.error('Embed extraction error:', error);
            return embedUrl;
        }
    }
}

// ========================================
// GOGOANIMES.WATCH SCRAPER
// ========================================

class GogoWatchExtractor {
    constructor() {
        this.baseUrl = 'https://www.gogoanimes.watch';
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://www.gogoanimes.watch/',
        };
    }

    async fetchPage(url) {
        try {
            const response = await fetch(url, { 
                headers: this.headers,
                signal: AbortSignal.timeout(10000)
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.text();
        } catch (error) {
            console.error(`GogoWatch fetch error:`, error.message);
            throw error;
        }
    }

    /**
     * Extract video from episode page
     */
    async extractVideo(episodeSlug) {
        try {
            const url = `${this.baseUrl}/${episodeSlug}/`;
            const html = await this.fetchPage(url);
            const $ = cheerio.load(html);
            
            const embedSources = {};
            
            $('iframe').each((index, element) => {
                const src = $(element).attr('src') || $(element).attr('data-lazy-src');
                if (src && src.includes('http')) {
                    embedSources[`server${index + 1}`] = src;
                }
            });

            // Extract video from first embed
            const firstEmbed = Object.values(embedSources)[0];
            if (!firstEmbed) {
                throw new Error('No embed found');
            }

            const videoUrl = await this.extractFromEmbed(firstEmbed);

            return {
                sources: [
                    {
                        file: videoUrl,
                        type: videoUrl.includes('.m3u8') ? 'hls' : 'mp4',
                        label: 'English Dub'
                    }
                ],
                sources_bk: [],
                servers: embedSources
            };
        } catch (error) {
            console.error('GogoWatch extractVideo error:', error);
            throw error;
        }
    }

    async extractFromEmbed(embedUrl) {
        try {
            const html = await this.fetchPage(embedUrl);

            const patterns = [
                /file:\s*["']([^"']+\.m3u8[^"']*)["']/i,
                /source:\s*["']([^"']+\.m3u8[^"']*)["']/i,
            ];

            for (const pattern of patterns) {
                const match = html.match(pattern);
                if (match && match[1]) {
                    return match[1];
                }
            }

            return embedUrl;
        } catch (error) {
            return embedUrl;
        }
    }
}

// ========================================
// UNIFIED API FUNCTIONS
// ========================================

const hiAnime = new HiAnimeExtractor();
const gogoWatch = new GogoWatchExtractor();

/**
 * Get home page data (Recent + Trending)
 */
export async function getHome() {
    try {
        return await hiAnime.getHome();
    } catch (error) {
        console.error('getHome error:', error);
        return { recent: [], trending: [] };
    }
}

/**
 * Get recent anime
 */
export async function getRecentAnime(page = 1) {
    try {
        const home = await hiAnime.getHome();
        return {
            results: home.recent,
            hasNextPage: page < 3
        };
    } catch (error) {
        console.error('getRecentAnime error:', error);
        return { results: [], hasNextPage: false };
    }
}

/**
 * Get popular/trending anime
 */
export async function getPopularAnime(page = 1) {
    try {
        const home = await hiAnime.getHome();
        return {
            results: home.trending,
            hasNextPage: page < 3
        };
    } catch (error) {
        console.error('getPopularAnime error:', error);
        return { results: [], hasNextPage: false };
    }
}

/**
 * Search anime
 */
export async function getSearch(query, page = 1) {
    try {
        const result = await hiAnime.searchAnime(query, page);
        return result;
    } catch (error) {
        console.error('getSearch error:', error);
        return { results: [], hasNextPage: false };
    }
}

/**
 * Get anime details with episodes
 */
export async function getAnime(animeId) {
    try {
        const details = await hiAnime.getAnimeDetails(animeId);
        
        // Format episodes as expected: [[episode_num, episode_id], ...]
        const episodeArray = details.episodes.map(ep => [
            ep.number.toString(),
            ep.id,
            ep.languages // Include language info
        ]);

        return {
            details: {
                title: details.title,
                image: details.image,
                synopsis: details.synopsis,
                otherName: '',
                release: '',
                status: details.status,
                genres: details.genres,
                type: details.type
            },
            episodes: episodeArray
        };
    } catch (error) {
        console.error('getAnime error:', error);
        throw error;
    }
}

/**
 * Get episode streaming sources
 * @param {string} episodeId - Episode ID or slug
 * @param {string} language - 'sub' (Japanese), 'dub' (English), 'hindi' (Hindi)
 */
export async function getEpisode(episodeId, language = 'sub') {
    try {
        console.log(`🎬 Getting episode: ${episodeId} (Language: ${language})`);

        // Try HiAnime first (supports sub/dub/hindi)
        if (!episodeId.includes('gogoanimes.watch')) {
            try {
                const category = language === 'dub' ? 'dub' : 'sub';
                const result = await hiAnime.getEpisodeSources(episodeId, category);
                
                return {
                    name: episodeId,
                    language: language,
                    ...result
                };
            } catch (hiAnimeError) {
                console.warn('HiAnime failed, trying GogoWatch:', hiAnimeError.message);
            }
        }

        // Fallback to GogoWatch (English dub only)
        const result = await gogoWatch.extractVideo(episodeId);
        
        return {
            name: episodeId,
            language: 'dub',
            ...result
        };
    } catch (error) {
        console.error('getEpisode error:', error);
        throw error;
    }
}

/**
 * Download links (not supported)
 */
export async function GogoDLScrapper(episodeId) {
    console.warn('⚠️ Download links not available');
    return {};
}

/**
 * Auth key (not needed)
 */
export async function getGogoAuthKey() {
    return null;
}
