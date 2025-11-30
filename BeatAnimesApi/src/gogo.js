// src/gogo.js - Multi-Source Scraper (HiAnime + GogoAnimes + Series2Watch)
import * as cheerio from 'cheerio';

/**
 * CONFIGURATION
 */
const SOURCES = {
    hianime: {
        baseUrl: 'https://hianime.to',
        ajaxUrl: 'https://hianime.to/ajax',
        priority: 1
    },
    gogoanimes: {
        baseUrl: 'https://www.gogoanimes.watch',
        priority: 2
    },
    series2watch: {
        baseUrl: 'https://series2watch.net',
        priority: 3
    }
};

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://hianime.to/',
    'Accept': 'text/html,application/json'
};

// ========================================
// HIANIME.TO SCRAPER
// ========================================

class HiAnimeExtractor {
    constructor() {
        this.baseUrl = SOURCES.hianime.baseUrl;
        this.ajaxUrl = SOURCES.hianime.ajaxUrl;
    }

    async fetchPage(url) {
        try {
            const response = await fetch(url, { 
                headers: HEADERS,
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
                headers: HEADERS,
                signal: AbortSignal.timeout(15000)
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error(`HiAnime JSON error:`, error.message);
            throw error;
        }
    }

    parseAnimeCard($, element) {
        try {
            const $el = $(element);
            const title = $el.find('.film-name a').attr('title') || $el.find('.film-name').text().trim();
            const href = $el.find('.film-poster a').attr('href');
            const id = href?.split('/')[1]?.split('?')[0];
            const image = $el.find('.film-poster img').attr('data-src') || $el.find('.film-poster img').attr('src');
            const episodeNum = $el.find('.fd-infor .tick-sub, .fd-infor .tick-dub, .fd-infor .tick-eps').first().text().trim();

            if (!id || !title) return null;

            return {
                id: id,
                title: title,
                image: image || '',
                episode: episodeNum || '',
                url: `${this.baseUrl}/${id}`,
                source: 'hianime'
            };
        } catch (error) {
            return null;
        }
    }

    async getHome() {
        try {
            const html = await this.fetchPage(this.baseUrl);
            const $ = cheerio.load(html);

            const recent = [];
            const trending = [];

            $('#anime-recently-updated .flw-item, #trending-home .flw-item').slice(0, 12).each((i, el) => {
                const anime = this.parseAnimeCard($, $(el));
                if (anime) recent.push(anime);
            });

            $('#anime-trending .flw-item').slice(0, 12).each((i, el) => {
                const anime = this.parseAnimeCard($, $(el));
                if (anime) trending.push(anime);
            });

            console.log(`✅ HiAnime: ${recent.length} recent, ${trending.length} trending`);
            return { recent, trending };
        } catch (error) {
            console.error('❌ HiAnime getHome error:', error);
            return { recent: [], trending: [] };
        }
    }

    async searchAnime(query) {
        try {
            const searchUrl = `${this.baseUrl}/search?keyword=${encodeURIComponent(query)}`;
            const html = await this.fetchPage(searchUrl);
            const $ = cheerio.load(html);

            const results = [];
            $('.flw-item').each((i, el) => {
                const anime = this.parseAnimeCard($, $(el));
                if (anime) results.push(anime);
            });

            console.log(`✅ HiAnime search: ${results.length} results`);
            return { results, hasNextPage: false };
        } catch (error) {
            console.error('❌ HiAnime search error:', error);
            return { results: [], hasNextPage: false };
        }
    }

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

            const dataId = $('#wrapper').attr('data-id');
            const episodes = await this.getEpisodeList(dataId);

            return {
                id: animeId,
                title,
                image,
                synopsis,
                type,
                status,
                genres,
                episodes,
                source: 'hianime'
            };
        } catch (error) {
            console.error('❌ HiAnime details error:', error);
            throw error;
        }
    }

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

                episodes.push([
                    number,
                    `hianime-${id}`,
                    { sub: true, dub: $el.find('.badge.badge-dub').length > 0 }
                ]);
            });

            return episodes;
        } catch (error) {
            console.error('❌ HiAnime episodes error:', error);
            return [];
        }
    }
}

// ========================================
// GOGOANIMES.WATCH SCRAPER
// ========================================

class GogoWatchExtractor {
    constructor() {
        this.baseUrl = SOURCES.gogoanimes.baseUrl;
    }

    async fetchPage(url) {
        try {
            const response = await fetch(url, { 
                headers: HEADERS,
                signal: AbortSignal.timeout(10000)
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.text();
        } catch (error) {
            console.error(`GogoWatch fetch error:`, error.message);
            throw error;
        }
    }

    async getHome() {
        try {
            const html = await this.fetchPage(this.baseUrl);
            const $ = cheerio.load(html);

            const recent = [];
            const popular = [];

            // Recent releases
            $('.hs-recent-item, .recent-item').slice(0, 12).each((i, el) => {
                const $el = $(el);
                const title = $el.find('.name, .title').text().trim();
                const href = $el.find('a').attr('href');
                const id = href?.split('/').pop()?.replace('/', '');
                const image = $el.find('img').attr('src') || $el.find('img').attr('data-src');

                if (id && title) {
                    recent.push({
                        id,
                        title,
                        image: image || '',
                        source: 'gogoanimes'
                    });
                }
            });

            // Popular
            $('.hs-popular-item, .popular-item').slice(0, 12).each((i, el) => {
                const $el = $(el);
                const title = $el.find('.name, .title').text().trim();
                const href = $el.find('a').attr('href');
                const id = href?.split('/').pop()?.replace('/', '');
                const image = $el.find('img').attr('src') || $el.find('img').attr('data-src');

                if (id && title) {
                    popular.push({
                        id,
                        title,
                        image: image || '',
                        source: 'gogoanimes'
                    });
                }
            });

            console.log(`✅ GogoWatch: ${recent.length} recent, ${popular.length} popular`);
            return { recent, popular };
        } catch (error) {
            console.error('❌ GogoWatch getHome error:', error);
            return { recent: [], popular: [] };
        }
    }

    async searchAnime(query) {
        try {
            const searchUrl = `${this.baseUrl}/search/${encodeURIComponent(query)}`;
            const html = await this.fetchPage(searchUrl);
            const $ = cheerio.load(html);

            const results = [];
            $('.anime-item, .item').each((i, el) => {
                const $el = $(el);
                const title = $el.find('.name, .title').text().trim();
                const href = $el.find('a').attr('href');
                const id = href?.split('/').pop();
                const image = $el.find('img').attr('src') || $el.find('img').attr('data-src');

                if (id && title) {
                    results.push({
                        id,
                        title,
                        image: image || '',
                        source: 'gogoanimes'
                    });
                }
            });

            console.log(`✅ GogoWatch search: ${results.length} results`);
            return { results, hasNextPage: false };
        } catch (error) {
            console.error('❌ GogoWatch search error:', error);
            return { results: [], hasNextPage: false };
        }
    }
}

// ========================================
// SERIES2WATCH.NET SCRAPER
// ========================================

class Series2WatchExtractor {
    constructor() {
        this.baseUrl = SOURCES.series2watch.baseUrl;
    }

    async fetchPage(url) {
        try {
            const response = await fetch(url, { 
                headers: HEADERS,
                signal: AbortSignal.timeout(10000)
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.text();
        } catch (error) {
            console.error(`Series2Watch fetch error:`, error.message);
            throw error;
        }
    }

    async getHome() {
        try {
            const html = await this.fetchPage(this.baseUrl);
            const $ = cheerio.load(html);

            const recent = [];
            $('.post-item, .anime-item').slice(0, 12).each((i, el) => {
                const $el = $(el);
                const title = $el.find('.title, h3, h2').first().text().trim();
                const href = $el.find('a').attr('href');
                const id = href?.split('/').pop();
                const image = $el.find('img').attr('src') || $el.find('img').attr('data-src');

                if (id && title) {
                    recent.push({
                        id,
                        title,
                        image: image || '',
                        source: 'series2watch'
                    });
                }
            });

            console.log(`✅ Series2Watch: ${recent.length} items`);
            return { recent, popular: recent };
        } catch (error) {
            console.error('❌ Series2Watch getHome error:', error);
            return { recent: [], popular: [] };
        }
    }
}

// ========================================
// UNIFIED API EXPORTS
// ========================================

const hiAnime = new HiAnimeExtractor();
const gogoWatch = new GogoWatchExtractor();
const series2Watch = new Series2WatchExtractor();

export async function getHome() {
    try {
        console.log('🔄 Fetching home data from all sources...');
        
        const [hiAnimeData, gogoData, series2Data] = await Promise.allSettled([
            hiAnime.getHome(),
            gogoWatch.getHome(),
            series2Watch.getHome()
        ]);

        const recent = [];
        const popular = [];

        // Combine all sources
        if (hiAnimeData.status === 'fulfilled') {
            recent.push(...hiAnimeData.value.recent);
            popular.push(...hiAnimeData.value.trending);
        }
        if (gogoData.status === 'fulfilled') {
            recent.push(...gogoData.value.recent);
            popular.push(...gogoData.value.popular);
        }
        if (series2Data.status === 'fulfilled') {
            recent.push(...series2Data.value.recent);
            popular.push(...series2Data.value.popular);
        }

        console.log(`✅ Total: ${recent.length} recent, ${popular.length} popular`);
        
        return {
            recent: recent.slice(0, 24),
            trending: popular.slice(0, 24)
        };
    } catch (error) {
        console.error('❌ getHome error:', error);
        return { recent: [], trending: [] };
    }
}

export async function getRecentAnime(page = 1) {
    const home = await getHome();
    return {
        results: home.recent,
        hasNextPage: page < 3
    };
}

export async function getPopularAnime(page = 1) {
    const home = await getHome();
    return {
        results: home.trending,
        hasNextPage: page < 3
    };
}

export async function getSearch(query, page = 1) {
    try {
        console.log(`🔍 Searching: ${query}`);
        
        const [hiAnimeResults, gogoResults] = await Promise.allSettled([
            hiAnime.searchAnime(query),
            gogoWatch.searchAnime(query)
        ]);

        const results = [];
        
        if (hiAnimeResults.status === 'fulfilled') {
            results.push(...hiAnimeResults.value.results);
        }
        if (gogoResults.status === 'fulfilled') {
            results.push(...gogoResults.value.results);
        }

        console.log(`✅ Found ${results.length} results`);
        return { results, hasNextPage: false };
    } catch (error) {
        console.error('❌ Search error:', error);
        return { results: [], hasNextPage: false };
    }
}

export async function getAnime(animeId) {
    try {
        console.log(`📺 Getting anime: ${animeId}`);
        
        // Try HiAnime first
        if (!animeId.includes('gogoanimes') && !animeId.includes('series2watch')) {
            try {
                const details = await hiAnime.getAnimeDetails(animeId);
                
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
                    episodes: details.episodes
                };
            } catch (hiAnimeError) {
                console.warn('HiAnime failed, trying fallback');
            }
        }

        // Fallback response
        throw new Error('Anime not found on available sources');
    } catch (error) {
        console.error('❌ getAnime error:', error);
        throw error;
    }
}

export async function getEpisode(episodeId, language = 'sub') {
    try {
        console.log(`🎬 Getting episode: ${episodeId}`);
        
        // Placeholder - implement video extraction
        return {
            name: episodeId,
            language,
            sources: [{
                file: 'https://example.com/video.m3u8',
                type: 'hls'
            }],
            sources_bk: [],
            servers: {}
        };
    } catch (error) {
        console.error('❌ getEpisode error:', error);
        throw error;
    }
}

export async function GogoDLScrapper(episodeId) {
    console.warn('⚠️ Download not supported');
    return {};
}

export async function getGogoAuthKey() {
    return null;
}
