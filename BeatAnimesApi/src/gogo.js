// gogo.js - GogoAnimes.watch Video Extractor
// This extracts videos from gogoanimes.watch (WordPress site with embedded players)

const axios = require('axios');
const cheerio = require('cheerio');

/**
 * GogoAnimes.watch Extractor Class
 * Note: This site uses WordPress and embeds videos from third-party hosts
 */
class GogoExtractor {
    constructor() {
        this.baseUrl = 'https://www.gogoanimes.watch';
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.gogoanimes.watch/',
        };
    }

    /**
     * Extract video from episode page URL
     * @param {string} episodeUrl - Full episode URL or slug
     * @returns {Promise<Object>} Video sources and servers
     */
    async extractVideo(episodeUrl) {
        try {
            // Ensure full URL
            const fullUrl = episodeUrl.startsWith('http') 
                ? episodeUrl 
                : `${this.baseUrl}/${episodeUrl}/`;

            console.log(`🔍 Extracting video from: ${fullUrl}`);

            // Step 1: Get episode page HTML
            const response = await axios.get(fullUrl, { 
                headers: this.headers,
                timeout: 10000 
            });
            
            const $ = cheerio.load(response.data);
            
            // Step 2: Extract embedded iframe sources
            const embedSources = await this.extractEmbedSources($);
            
            // Step 3: Get direct video URLs from embed hosts
            const videoSources = await this.extractFromEmbeds(embedSources);
            
            return {
                success: true,
                sources: videoSources.primary,
                sources_bk: videoSources.backup,
                servers: embedSources
            };
        } catch (error) {
            console.error('❌ Video extraction error:', error.message);
            throw new Error(`Failed to extract video: ${error.message}`);
        }
    }

    /**
     * Extract all iframe embed sources from the page
     */
    extractEmbedSources($) {
        const sources = {};
        
        try {
            // Method 1: Look for iframes in content
            $('iframe').each((index, element) => {
                const src = $(element).attr('src') || $(element).attr('data-lazy-src');
                
                if (src && src.includes('http')) {
                    // Identify host
                    const host = this.identifyHost(src);
                    sources[host || `server${index + 1}`] = src;
                }
            });

            // Method 2: Look for data-video attributes (alternative servers)
            $('[data-video]').each((index, element) => {
                const src = $(element).attr('data-video');
                if (src && src.includes('http')) {
                    const host = this.identifyHost(src);
                    sources[host || `alt${index + 1}`] = src;
                }
            });

            console.log('📡 Found embed sources:', Object.keys(sources));
            return sources;
        } catch (error) {
            console.error('Embed extraction error:', error);
            return sources;
        }
    }

    /**
     * Identify the host from URL
     */
    identifyHost(url) {
        if (url.includes('gradehgplus.com')) return 'gradehgplus';
        if (url.includes('streamwish')) return 'streamwish';
        if (url.includes('doodstream')) return 'doodstream';
        if (url.includes('filemoon')) return 'filemoon';
        if (url.includes('vidguard')) return 'vidguard';
        if (url.includes('mixdrop')) return 'mixdrop';
        if (url.includes('mp4upload')) return 'mp4upload';
        if (url.includes('gogostream')) return 'gogostream';
        
        // Extract domain name
        try {
            const urlObj = new URL(url);
            return urlObj.hostname.split('.')[0];
        } catch {
            return 'unknown';
        }
    }

    /**
     * Extract actual video URLs from embed hosts
     */
    async extractFromEmbeds(embedSources) {
        const primary = [];
        const backup = [];

        for (const [host, embedUrl] of Object.entries(embedSources)) {
            try {
                console.log(`🎬 Extracting from ${host}...`);
                
                let videoUrl = null;

                // Try to extract based on host
                switch(host) {
                    case 'gradehgplus':
                        videoUrl = await this.extractFromGradeHG(embedUrl);
                        break;
                    case 'streamwish':
                        videoUrl = await this.extractFromStreamwish(embedUrl);
                        break;
                    case 'filemoon':
                        videoUrl = await this.extractFromFilemoon(embedUrl);
                        break;
                    default:
                        // Generic extraction
                        videoUrl = await this.genericExtract(embedUrl);
                }

                if (videoUrl) {
                    const source = {
                        file: videoUrl,
                        type: videoUrl.includes('.m3u8') ? 'hls' : 'mp4',
                        label: host
                    };

                    if (primary.length === 0) {
                        primary.push(source);
                    } else {
                        backup.push(source);
                    }
                }
            } catch (error) {
                console.error(`Failed to extract from ${host}:`, error.message);
            }
        }

        return { primary, backup };
    }

    /**
     * Extract video from GradeHG embed
     */
    async extractFromGradeHG(embedUrl) {
        try {
            const response = await axios.get(embedUrl, { 
                headers: this.headers,
                timeout: 10000
            });
            
            const html = response.data;

            // Method 1: Look for direct file URL
            const fileMatch = html.match(/file:\s*["']([^"']+\.m3u8[^"']*)["']/i) ||
                            html.match(/source:\s*["']([^"']+\.m3u8[^"']*)["']/i);
            
            if (fileMatch) {
                console.log('✅ Found M3U8 from GradeHG');
                return fileMatch[1];
            }

            // Method 2: Look for sources array
            const sourcesMatch = html.match(/sources:\s*\[(.*?)\]/s);
            if (sourcesMatch) {
                const urlMatch = sourcesMatch[1].match(/["']([^"']+\.m3u8[^"']*)["']/);
                if (urlMatch) {
                    console.log('✅ Found M3U8 from sources array');
                    return urlMatch[1];
                }
            }

            // Method 3: Look for eval/packed code
            const evalMatch = html.match(/eval\((.*?)\)/s);
            if (evalMatch) {
                // Try to decode packed JavaScript
                const decodedUrl = this.decodePackedJs(html);
                if (decodedUrl) return decodedUrl;
            }

            console.warn('⚠️ Could not extract video from GradeHG');
            return null;
        } catch (error) {
            console.error('GradeHG extraction error:', error.message);
            return null;
        }
    }

    /**
     * Extract from Streamwish
     */
    async extractFromStreamwish(embedUrl) {
        try {
            const response = await axios.get(embedUrl, { headers: this.headers });
            const html = response.data;

            const fileMatch = html.match(/file:\s*["']([^"']+)["']/i);
            if (fileMatch) {
                console.log('✅ Found video from Streamwish');
                return fileMatch[1];
            }

            return null;
        } catch (error) {
            console.error('Streamwish extraction error:', error.message);
            return null;
        }
    }

    /**
     * Extract from Filemoon
     */
    async extractFromFilemoon(embedUrl) {
        try {
            const response = await axios.get(embedUrl, { headers: this.headers });
            const html = response.data;

            const fileMatch = html.match(/file:\s*["']([^"']+\.m3u8[^"']*)["']/i);
            if (fileMatch) {
                console.log('✅ Found M3U8 from Filemoon');
                return fileMatch[1];
            }

            return null;
        } catch (error) {
            console.error('Filemoon extraction error:', error.message);
            return null;
        }
    }

    /**
     * Generic video extraction (tries common patterns)
     */
    async genericExtract(embedUrl) {
        try {
            const response = await axios.get(embedUrl, { 
                headers: this.headers,
                timeout: 10000
            });
            
            const html = response.data;

            // Try multiple patterns
            const patterns = [
                /file:\s*["']([^"']+\.m3u8[^"']*)["']/i,
                /source:\s*["']([^"']+\.m3u8[^"']*)["']/i,
                /src:\s*["']([^"']+\.m3u8[^"']*)["']/i,
                /url:\s*["']([^"']+\.m3u8[^"']*)["']/i,
                /["']([^"']+\.m3u8[^"']*)["']/i // Last resort
            ];

            for (const pattern of patterns) {
                const match = html.match(pattern);
                if (match && match[1].startsWith('http')) {
                    console.log('✅ Found video URL');
                    return match[1];
                }
            }

            return null;
        } catch (error) {
            console.error('Generic extraction error:', error.message);
            return null;
        }
    }

    /**
     * Decode packed JavaScript (basic implementation)
     */
    decodePackedJs(html) {
        try {
            // Look for packed code pattern
            const packedMatch = html.match(/eval\(function\(p,a,c,k,e,d\).*?\}\((.*?)\)\)/s);
            if (!packedMatch) return null;

            // This is a simplified decoder - full implementation would require unpacker.js
            const m3u8Match = html.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/i);
            if (m3u8Match) {
                return m3u8Match[0];
            }

            return null;
        } catch (error) {
            return null;
        }
    }

    /**
     * Get anime info from page
     */
    async getAnimeInfo(animeSlug) {
        try {
            const url = `${this.baseUrl}/${animeSlug}/`;
            const response = await axios.get(url, { headers: this.headers });
            const $ = cheerio.load(response.data);

            // Extract episode links
            const episodes = [];
            $('a[href*="episode"]').each((index, element) => {
                const href = $(element).attr('href');
                const text = $(element).text().trim();
                
                if (href && text.match(/ep\s*\d+/i)) {
                    const epNum = text.match(/\d+/)?.[0];
                    if (epNum) {
                        episodes.push({
                            number: parseInt(epNum),
                            url: href,
                            slug: href.split('/').filter(Boolean).pop()
                        });
                    }
                }
            });

            return {
                title: $('h1, h2').first().text().trim() || animeSlug,
                episodes: episodes.sort((a, b) => a.number - b.number)
            };
        } catch (error) {
            console.error('Anime info error:', error);
            return null;
        }
    }
}

// Export for use in your API
module.exports = GogoExtractor;

// Example usage and testing
if (require.main === module) {
    const extractor = new GogoExtractor();
    
    // Test with Naruto episode
    const testUrl = 'naruto-uzmaki-episode-1';
    
    console.log('🧪 Testing GogoAnimes.watch extractor...\n');
    
    extractor.extractVideo(testUrl)
        .then(result => {
            console.log('\n✅ Extraction successful!');
            console.log('\n📊 Results:');
            console.log(JSON.stringify(result, null, 2));
        })
        .catch(error => {
            console.error('\n❌ Extraction failed:', error.message);
        });
}
