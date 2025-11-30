import {
    generateEncryptAjaxParameters,
    decryptEncryptAjaxResponse,
} from "./gogo_extractor.js";
import { load } from "cheerio";

// ✅ Use the actual working GoGoAnime domain
const GOGO_DOMAINS = [
    "https://gogoanimes.watch"  // This is the real domain from your screenshot
];

let BaseURL = GOGO_DOMAINS[0];

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWithFallback(path, options = {}) {
    const url = BaseURL + path;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: {
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5",
                "Referer": BaseURL + "/",
                ...options.headers
            }
        });
        
        clearTimeout(timeout);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        return response;
    } catch (error) {
        clearTimeout(timeout);
        throw error;
    }
}

// ✅ FIXED: Based on actual GoGoAnime HTML structure from your screenshot
async function getHome() {
    try {
        const response = await fetchWithFallback("/");
        const html = await response.text();
        const $ = load(html);
        
        const recent = [];
        const trending = [];

        // ✅ Recent Episodes - Using actual selector from GoGoAnime source
        $("ul.items li").each((i, el) => {
            const $el = $(el);
            const linkEl = $el.find("p.name a");
            const title = linkEl.attr("title") || linkEl.text().trim();
            
            if (!title) return;
            
            const href = linkEl.attr("href") || "";
            const imageEl = $el.find("div img");
            const image = imageEl.attr("src") || "";
            const epText = $el.find("p.episode").text().trim();
            
            recent.push({
                id: href.replace(/^\//, ""),
                title: title,
                image: image,
                episode: epText
            });
        });

        // ✅ Trending/Popular - Using actual "On Going Series" from sidebar
        $("ul.items li").each((i, el) => {
            const $el = $(el);
            const linkEl = $el.find("a");
            const title = linkEl.attr("title") || linkEl.find("a").text().trim();
            
            if (!title || trending.length >= 20) return;
            
            const href = linkEl.attr("href") || "";
            const imageEl = $el.find("img");
            const image = imageEl.attr("src") || "";
            
            trending.push({
                id: href.replace(/^\//, "").replace(/^category\//, ""),
                title: title,
                image: image
            });
        });

        console.log(`[GOGO] Home loaded: ${recent.length} recent, ${trending.length} trending`);
        return { recent, trending };

    } catch (e) {
        console.error("getHome error:", e.message);
        throw new Error("Failed to load GogoAnime homepage data.");
    }
}

async function getSearch(query, page = 1) {
    try {
        const response = await fetchWithFallback(`/search.html?keyword=${encodeURIComponent(query)}&page=${page}`);
        const html = await response.text();
        const $ = load(html);

        const data = [];
        
        $("ul.items li").each((i, el) => {
            const $el = $(el);
            const linkEl = $el.find("p.name a");
            const title = linkEl.attr("title") || linkEl.text().trim();
            
            if (!title) return;
            
            const href = linkEl.attr("href") || "";
            const imageEl = $el.find("div img");
            const image = imageEl.attr("src") || "";
            const released = $el.find("p.released").text().replace("Released:", "").trim();
            
            data.push({
                id: href.replace(/^\/category\//, "").replace(/^\//, ""),
                title: title,
                image: image,
                release: released
            });
        });

        console.log(`[GOGO] Search found ${data.length} results for '${query}'`);
        return { results: data };
    } catch (e) {
        console.error("getSearch error:", e.message);
        throw new Error(`Failed to fetch GogoAnime search results for: ${query}`);
    }
}

// ✅ COMPLETELY REWRITTEN: Proper anime detail extraction
async function getAnime(animeId) {
    try {
        const response = await fetchWithFallback(`/category/${animeId}`);
        const html = await response.text();
        const $ = load(html);

        const details = {
            id: animeId,
            title: $("div.anime_info_body_bg h1").text().trim() || "Unknown",
            image: $("div.anime_info_body_bg img").attr("src") || "",
            synopsis: "",
            genres: [],
            release: "Unknown",
            status: "Unknown",
            otherName: "N/A",
            type: "TV"
        };

        // Extract details from p.type elements
        $("p.type").each((i, el) => {
            const $el = $(el);
            const text = $el.text();
            
            if (text.includes("Plot Summary:")) {
                details.synopsis = text.replace("Plot Summary:", "").trim();
            } else if (text.includes("Genre:")) {
                $el.find("a").each((j, a) => {
                    const genre = $(a).attr("title") || $(a).text().trim();
                    if (genre) details.genres.push(genre);
                });
            } else if (text.includes("Released:")) {
                details.release = text.replace("Released:", "").trim();
            } else if (text.includes("Status:")) {
                details.status = text.replace("Status:", "").trim();
            } else if (text.includes("Other name:")) {
                details.otherName = text.replace("Other name:", "").trim();
            } else if (text.includes("Type:")) {
                const typeText = $el.find("a").text().trim();
                if (typeText) details.type = typeText;
            }
        });

        // ✅ FIXED: Get episode list using the AJAX endpoint
        const movieId = $("#movie_id").attr("value");
        const alias = $("#alias_anime").attr("value") || animeId;
        
        let episodes = [];
        
        if (movieId) {
            // Get episode range from pagination
            const firstEp = $("#episode_page li").first().find("a");
            const lastEp = $("#episode_page li").last().find("a");
            
            const epStart = firstEp.attr("ep_start") || "0";
            const epEnd = lastEp.attr("ep_end") || "0";
            
            console.log(`[GOGO] ${animeId}: movieId=${movieId}, alias=${alias}, episodes ${epStart}-${epEnd}`);
            
            if (epEnd !== "0") {
                episodes = await getEpisodeList(epStart, epEnd, movieId, alias, animeId);
            }
        } else {
            console.warn(`[GOGO] ${animeId}: No movie_id found, cannot fetch episodes`);
        }

        console.log(`[GOGO] ${animeId}: Returning ${episodes.length} episodes`);
        return { details, episodes };
    } catch (e) {
        console.error("getAnime error:", e.message);
        throw new Error(`Failed to fetch GogoAnime details for: ${animeId}`);
    }
}

// ✅ COMPLETELY REWRITTEN: Proper episode list extraction
async function getEpisodeList(epStart, epEnd, movieId, alias, animeId) {
    try {
        // Build the correct AJAX URL
        const ajaxUrl = `${BaseURL}/load-list-episode?ep_start=${epStart}&ep_end=${epEnd}&id=${movieId}&default_ep=0&alias=${alias}`;
        
        console.log(`[GOGO] Fetching episodes from: ${ajaxUrl}`);
        
        const response = await fetch(ajaxUrl, {
            headers: {
                "User-Agent": USER_AGENT,
                "X-Requested-With": "XMLHttpRequest",
                "Referer": `${BaseURL}/category/${animeId}`
            }
        });
        
        if (!response.ok) {
            throw new Error(`AJAX request failed: ${response.status}`);
        }
        
        const html = await response.text();
        
        // Debug: log first 200 chars
        console.log(`[GOGO] AJAX Response preview: ${html.substring(0, 200)}...`);
        
        const $ = load(html);
        const episodes = [];
        
        // ✅ GoGoAnime returns <li> elements with <a> tags inside
        // The structure is: <ul id="episode_related"><li><a href="/anime-episode-X">...</a></li></ul>
        
        // Try primary selector
        $("#episode_related li a").each((i, el) => {
            const $el = $(el);
            const href = $el.attr("href");
            
            if (href && href.includes("-episode-")) {
                const episodeId = href.trim().replace(/^\//, "");
                const epNum = episodeId.split("-episode-")[1] || (i + 1);
                
                episodes.push({
                    id: episodeId,
                    episode: epNum.toString().replace(/[^0-9.]/g, ""),
                    title: $el.find(".name").text().trim() || `Episode ${epNum}`
                });
            }
        });
        
        // Fallback: try without ID
        if (episodes.length === 0) {
            console.log(`[GOGO] Primary selector failed, trying fallback...`);
            
            $("li a").each((i, el) => {
                const $el = $(el);
                const href = $el.attr("href");
                
                if (href && href.includes("-episode-")) {
                    const episodeId = href.trim().replace(/^\//, "");
                    const epNum = episodeId.split("-episode-")[1] || (i + 1);
                    
                    episodes.push({
                        id: episodeId,
                        episode: epNum.toString().replace(/[^0-9.]/g, ""),
                        title: `Episode ${epNum}`
                    });
                }
            });
        }
        
        // If still no episodes, try just <a> tags
        if (episodes.length === 0) {
            console.log(`[GOGO] Fallback also failed, trying all <a> tags...`);
            
            $("a").each((i, el) => {
                const $el = $(el);
                const href = $el.attr("href");
                
                if (href && href.includes("-episode-")) {
                    const episodeId = href.trim().replace(/^\//, "");
                    const epNum = episodeId.split("-episode-")[1] || (i + 1);
                    
                    episodes.push({
                        id: episodeId,
                        episode: epNum.toString().replace(/[^0-9.]/g, ""),
                        title: `Episode ${epNum}`
                    });
                }
            });
        }

        console.log(`[GOGO] Extracted ${episodes.length} episodes`);
        
        // Return in correct order (episode 1 first)
        return episodes.reverse();
    } catch (e) {
        console.error(`[GOGO] getEpisodeList error: ${e.message}`);
        return [];
    }
}

async function getEpisode(episodeId) {
    try {
        const response = await fetchWithFallback(`/${episodeId}`);
        const html = await response.text();
        const $ = load(html);

        const servers = {};
        
        // Extract available servers
        $("div.anime_muti_link ul li").each((i, el) => {
            const $el = $(el);
            const link = $el.find("a");
            const dataVideo = link.attr("data-video");
            const serverName = link.text().trim().toLowerCase();
            
            if (dataVideo) {
                servers[serverName] = dataVideo.startsWith('http') ? dataVideo : `https:${dataVideo}`;
            }
        });

        // Get main iframe
        const iframeUrl = $("div.play-video iframe").attr("src");
        if (iframeUrl) {
            servers['default'] = iframeUrl.startsWith('http') ? iframeUrl : `https:${iframeUrl}`;
        }

        // Try to extract streaming sources
        let streaming = null;
        const gogoUrl = servers['gogoserver'] || servers['default'];
        
        if (gogoUrl) {
            try {
                const embedResponse = await fetch(gogoUrl);
                const embedHtml = await embedResponse.text();
                const $embed = load(embedHtml);
                
                const videoId = new URL(gogoUrl).searchParams.get("id");
                if (videoId) {
                    const params = await generateEncryptAjaxParameters($embed, videoId);
                    const encryptUrl = `${new URL(gogoUrl).origin}/encrypt-ajax.php?${params}`;
                    
                    const encResponse = await fetch(encryptUrl, {
                        headers: { "X-Requested-With": "XMLHttpRequest" }
                    });
                    
                    const encData = await encResponse.json();
                    const decrypted = decryptEncryptAjaxResponse(encData);
                    
                    streaming = {
                        sources: decrypted.map(s => ({ file: s.file, label: s.label })),
                        sources_bk: decrypted.map(s => ({ file: s.file, label: s.label }))
                    };
                }
            } catch (embedError) {
                console.warn("Failed to extract streaming sources:", embedError.message);
            }
        }

        return { 
            name: $("h1").first().text().trim() || episodeId,
            stream: streaming,
            servers: servers 
        };

    } catch (e) {
        console.error("getEpisode error:", e.message);
        throw new Error(`Failed to fetch streaming links for: ${episodeId}`);
    }
}

async function getRecentAnime(page = 1) {
    try {
        const response = await fetchWithFallback(`/?page=${page}`);
        const html = await response.text();
        const $ = load(html);

        const data = [];
        $("ul.items li").each((i, el) => {
            const $el = $(el);
            const linkEl = $el.find("p.name a");
            const title = linkEl.attr("title") || linkEl.text().trim();
            
            if (!title) return;
            
            data.push({
                id: linkEl.attr("href").replace(/^\//, ""),
                title: title,
                image: $el.find("img").attr("src") || "",
                episode: $el.find("p.episode").text().trim()
            });
        });

        return { results: data };
    } catch (e) {
        console.error("getRecentAnime error:", e.message);
        throw new Error("Failed to fetch recent GogoAnime data.");
    }
}

async function getPopularAnime(page = 1) {
    try {
        // GoGoAnime doesn't have a dedicated popular page, use home data
        const homeData = await getHome();
        return { results: homeData.trending };
    } catch (e) {
        console.error("getPopularAnime error:", e.message);
        throw new Error("Failed to fetch popular GogoAnime data.");
    }
}

async function GogoDLScrapper(animeid) {
    try {
        const response = await fetchWithFallback("/" + animeid);
        const html = await response.text();
        const $ = load(html);
        
        const data = {};
        $("div.cf-download a").each((i, link) => {
            const $link = $(link);
            const quality = $link.text().trim();
            const url = $link.attr("href");
            if (quality && url) {
                data[quality] = url.trim();
            }
        });
        
        return data;
    } catch (e) {
        console.error("GogoDLScrapper error:", e.message);
        return {};
    }
}

async function getGogoAuthKey() {
    try {
        const response = await fetch(
            "https://api.github.com/repos/TechShreyash/TechShreyash/contents/gogoCookie.txt",
            { headers: { "User-Agent": USER_AGENT } }
        );
        const data = await response.json();
        return data["content"].replaceAll("\n", "");
    } catch (error) {
        console.error("getGogoAuthKey error:", error.message);
        return "";
    }
}

export {
    getSearch,
    getAnime,
    getRecentAnime,
    getPopularAnime,
    getEpisode,
    GogoDLScrapper,
    getGogoAuthKey,
    getHome,
};
