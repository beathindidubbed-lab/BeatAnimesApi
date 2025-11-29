import {
    generateEncryptAjaxParameters,
    decryptEncryptAjaxResponse,
} from "./gogo_extractor.js";
import { load } from "cheerio";

// Updated working domains
const GOGO_DOMAINS = [
    "https://anitaku.to",
    "https://gogoanime3.co",
    "https://gogoanime.hu"
];

let BaseURL = GOGO_DOMAINS[0];

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWithFallback(path, options = {}) {
    let lastError;
    const MAX_RETRIES = 2;
    
    for (const domain of GOGO_DOMAINS) {
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                const url = domain + path;
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 10000);

                const response = await fetch(url, {
                    ...options,
                    signal: controller.signal,
                    headers: {
                        "User-Agent": USER_AGENT,
                        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                        "Accept-Language": "en-US,en;q=0.5",
                        "Connection": "keep-alive",
                        "Referer": domain + "/",
                        ...options.headers
                    }
                });
                
                clearTimeout(timeout);

                if (response.ok) {
                    const htmlCheck = await response.clone().text();
                    if (htmlCheck.includes("<title>Redirecting...</title>") || 
                        htmlCheck.includes("Just a moment") ||
                        htmlCheck.includes("Checking your browser")) {
                        throw new Error("Anti-Bot/Cloudflare page detected");
                    }

                    BaseURL = domain;
                    return response;
                } else {
                    throw new Error(`Non-OK status: ${response.status} from ${domain}`);
                }
            } catch (error) {
                lastError = error;
                
                if (attempt < MAX_RETRIES) {
                    const delay = Math.pow(2, attempt) * 1000;
                    console.warn(`[GOGO Retry] Domain ${domain} failed (Attempt ${attempt + 1}/${MAX_RETRIES + 1}). Retrying in ${delay / 1000}s. Error: ${error.message}`);
                    await wait(delay);
                } else {
                    console.warn(`[GOGO Fallback] Domain ${domain} failed after ${MAX_RETRIES + 1} attempts. Trying next domain.`);
                }
            }
        }
    }

    throw new Error(`All GogoAnime domains failed. Last error: ${lastError ? lastError.message : "Unknown error"}`);
}

async function getHome() {
    try {
        const response = await fetchWithFallback("/?page=1");
        const html = await response.text();
        const $ = load(html);
        
        const recent = [];
        const trending = [];

        // Updated selectors for Anitaku structure
        // Recent episodes - Updated selector
        $("div.last_episodes ul.items li, ul.items li").each((i, el) => {
            const $el = $(el);
            const linkEl = $el.find("p.name a, .name a");
            const titleAttr = linkEl.attr("title");
            const titleText = linkEl.text().trim();
            const title = titleAttr || titleText;
            
            if (!title) return;
            
            const href = linkEl.attr("href");
            const imageEl = $el.find("div.img a img, .img img");
            const image = imageEl.attr("src") || imageEl.attr("data-src");
            const releaseEl = $el.find("p.released, .released");
            const episodeEl = $el.find("p.episode, .episode");
            
            recent.push({
                id: href ? href.replace(/^\//, "") : "",
                title: title,
                image: image || "",
                release: releaseEl.text().trim(),
                episode: parseInt(episodeEl.text().replace(/\D/g, "")) || 1
            });
        });

        // Trending/Popular - Updated selector
        $("div.added_series_body.popular ul.listing li, nav.genre ul li").each((i, el) => {
            const $el = $(el);
            const linkEl = $el.find("a");
            const title = linkEl.attr("title") || linkEl.text().trim();
            
            if (!title) return;
            
            const href = linkEl.attr("href");
            const imageEl = $el.find("img");
            const image = imageEl.attr("src") || imageEl.attr("data-src");
            
            trending.push({
                id: href ? href.replace(/^\/category\//, "").replace(/^\//, "") : "",
                title: title,
                image: image || "",
                release: $el.find("p.released, .released").text().replace("Released: ", "").trim()
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
        
        // Multiple selector attempts for search results
        const selectors = [
            "div.last_episodes ul.items li",
            "ul.items li",
            "div.items li",
            ".anime_list_body ul li"
        ];
        
        let found = false;
        for (const selector of selectors) {
            const elements = $(selector);
            if (elements.length > 0) {
                elements.each((i, el) => {
                    const $el = $(el);
                    const linkEl = $el.find("p.name a, .name a, a");
                    const title = linkEl.attr("title") || linkEl.text().trim();
                    
                    if (!title) return;
                    
                    const href = linkEl.attr("href");
                    const imageEl = $el.find("div.img a img, .img img, img");
                    const image = imageEl.attr("src") || imageEl.attr("data-src");
                    
                    data.push({
                        id: href ? href.replace(/^\/category\//, "").replace(/^\//, "") : "",
                        title: title,
                        image: image || "",
                        release: $el.find("p.released, .released").text().replace("Released: ", "").trim()
                    });
                });
                
                if (data.length > 0) {
                    found = true;
                    break;
                }
            }
        }

        if (data.length === 0) {
            console.warn(`[GOGO] Search for '${query}' returned 0 results using all selectors`);
        } else {
            console.log(`[GOGO] Search found ${data.length} results for '${query}'`);
        }

        return { results: data };
    } catch (e) {
        console.error("getSearch error:", e.message);
        throw new Error(`Failed to fetch GogoAnime search results for: ${query}`);
    }
}

async function getAnime(animeId) {
    try {
        const response = await fetchWithFallback(`/category/${animeId}`);
        const html = await response.text();
        const $ = load(html);

        const detailEl = $("div.anime_info_body_bg, div.anime_info_body");
        
        const details = {
            id: animeId,
            title: detailEl.find("h1").text().trim() || "Unknown",
            image: detailEl.find("img").attr("src") || "",
            synopsis: $("div.description, p.type:contains('Plot Summary'), .anime_info_body_bg p").eq(4).text().replace(/^Plot Summary:\s*/i, "").trim() || "No synopsis available",
            genres: [],
            release: "Unknown",
            status: "Unknown",
            otherName: "N/A"
        };

        // Extract genres
        $("p.type:contains('Genre') a, .genre a").each((i, el) => {
            const genre = $(el).attr("title") || $(el).text().trim();
            if (genre) details.genres.push(genre);
        });

        // Extract other details
        $("p.type").each((i, el) => {
            const text = $(el).text();
            if (text.includes("Released:")) {
                details.release = text.replace("Released:", "").trim();
            } else if (text.includes("Status:")) {
                details.status = $(el).find("a").text().trim() || text.replace("Status:", "").trim();
            } else if (text.includes("Other name:")) {
                details.otherName = text.replace("Other name:", "").trim();
            }
        });

        // Get episode list
        const epStart = $("#episode_page a, #episode_page li a").first().attr("ep_start") || "0";
        const epEnd = $("#episode_page a, #episode_page li a").last().attr("ep_end") || "0";
        const movieId = $("#movie_id").attr("value");
        const alias = $("#alias_anime").attr("value") || animeId;

        let episodes = [];
        if (movieId) {
            episodes = await getEpisodeList(epStart, epEnd, movieId, alias);
        }

        return { details, episodes };
    } catch (e) {
        console.error("getAnime error:", e.message);
        throw new Error(`Failed to fetch GogoAnime details for: ${animeId}`);
    }
}

async function getEpisodeList(epStart, epEnd, movieId, alias) {
    try {
        const url = `${BaseURL}/ajax/load-list-episode?ep_start=${epStart}&ep_end=${epEnd}&id=${movieId}&default_ep=0&alias=${alias}`;
        const response = await fetch(url, {
            headers: {
                "User-Agent": USER_AGENT,
                "X-Requested-With": "XMLHttpRequest"
            }
        });
        
        const html = await response.text();
        const $ = load(html);

        const episodes = [];
        $("li, a").each((i, el) => {
            const $el = $(el);
            const href = $el.attr("href") || $el.find("a").attr("href");
            
            if (href && href.includes("-episode-")) {
                const episodeId = href.replace(/^\//, "");
                const epNum = $el.find(".name").text().replace("EP", "").trim() || 
                              episodeId.split("-episode-")[1] || (i + 1);
                
                episodes.push({
                    id: episodeId,
                    episode: epNum.toString(),
                    title: `Episode ${epNum}`,
                    type: $el.find(".cate").text().trim() || "SUB"
                });
            }
        });

        return episodes.reverse();
    } catch (e) {
        console.error("getEpisodeList error:", e.message);
        return [];
    }
}

async function getEpisode(episodeId) {
    try {
        const response = await fetchWithFallback(`/${episodeId}`);
        const html = await response.text();
        const $ = load(html);

        const servers = {};
        
        // Extract server links
        $("div.anime_muti_link ul li, .cf-download a").each((i, el) => {
            const $el = $(el);
            const link = $el.find("a");
            const dataVideo = link.attr("data-video");
            const href = link.attr("href");
            const serverName = link.text().trim().toLowerCase();
            
            if (dataVideo) {
                servers[serverName] = dataVideo;
            } else if (href && href.startsWith("http")) {
                servers[serverName] = href;
            }
        });

        // Try to get the main iframe URL
        const iframeUrl = $("div.play-video iframe, #load_anime iframe").attr("src");
        if (iframeUrl) {
            servers['default'] = iframeUrl.startsWith('http') ? iframeUrl : `https:${iframeUrl}`;
        }

        // Extract streaming sources if available
        let streaming = null;
        const gogoUrl = servers['gogoserver'] || servers['default'] || iframeUrl;
        
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
            name: $("h1, .title").first().text().trim() || episodeId,
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
        const response = await fetchWithFallback(`/recent-release.html?page=${page}`);
        const html = await response.text();
        const $ = load(html);

        const data = [];
        $("ul.items li, div.last_episodes ul.items li").each((i, el) => {
            const $el = $(el);
            const linkEl = $el.find("a").first();
            const title = linkEl.attr("title") || $el.find(".name").text().trim();
            
            if (!title) return;
            
            data.push({
                id: linkEl.attr("href").replace(/^\//, ""),
                title: title,
                image: $el.find("img").attr("src") || "",
                episode: $el.find(".episode").text().trim(),
                release: $el.find(".released").text().trim()
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
        const response = await fetchWithFallback(`/popular.html?page=${page}`);
        const html = await response.text();
        const $ = load(html);

        const data = [];
        $("div.added_series_body.popular ul.items li, ul.items li").each((i, el) => {
            const $el = $(el);
            const linkEl = $el.find("a");
            const title = linkEl.attr("title") || linkEl.text().trim();
            
            if (!title) return;
            
            data.push({
                id: linkEl.attr("href").replace(/^\/category\//, "").replace(/^\//, ""),
                title: title,
                image: $el.find("img").attr("src") || "",
                genre: $el.find(".genre a").text().trim(),
                release: $el.find(".released").text().replace("Released:", "").trim()
            });
        });

        return { results: data };
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
