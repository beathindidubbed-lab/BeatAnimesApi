import {
    generateEncryptAjaxParameters,
    decryptEncryptAjaxResponse,
} from "./gogo_extractor.js";
import cheerio from "cheerio";

// UPDATED: Try multiple working GogoAnime domains
// Note: These domains are constantly changing. If the API fails, update this list.
const GOGO_DOMAINS = [
    "https://anitaku.pe",      // 1. Primary (often used)
    "https://anitaku.so",      // 2. Backup/Alternative
    "https://gogoanime.hu",    // 3. Backup
    "https://gogoanime3.co",   // 4. Backup
];

let BaseURL = GOGO_DOMAINS[0]; // Start with first domain

const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Function to try multiple domains if one fails
async function fetchWithFallback(path, options = {}) {
    let lastError;
    
    for (const domain of GOGO_DOMAINS) {
        try {
            const url = domain + path;
            console.log(`📡 Trying GogoAnime domain: ${domain}${path}`);
            const response = await fetch(url, {
                ...options,
                headers: {
                    "User-Agent": USER_AGENT,
                    ...options.headers
                }
            });
            
            if (response.ok) {
                BaseURL = domain; // Update to working domain
                console.log(`✅ Successfully connected to: ${domain}`);
                return response;
            }
        } catch (error) {
            lastError = error;
            console.warn(`⚠️ Failed to connect to ${domain}. Trying next domain...`);
        }
    }
    
    // If all domains fail
    throw new Error(`Failed to fetch from all GogoAnime domains. Last Error: ${lastError ? lastError.message : "Unknown"}`);
}

async function getSearch(query, page = 1) {
    try {
        const response = await fetchWithFallback(
            `/search.html?keyword=${encodeURIComponent(query)}&page=${page}`
        );
        const html = await response.text();
        const body = cheerio.load(html);
        const data = {};
        const results = [];
        let hasNextPage = false;
        const total = body(".pagination-container > ul > li.selected").text();

        // Pagination
        if (body(".pagination-container > ul > li.next").length) {
            hasNextPage = true;
        }

        // Anime listings
        body("div.last_episodes > ul > li").each((i, el) => {
            const anime = body(el).find("p.name > a");
            const img = body(el).find("div > a > img");
            results.push({
                id: anime.attr("href")?.split("/")[2],
                title: anime.attr("title"),
                image: img.attr("src"),
                releaseDate: body(el).find("p.released").text().trim(),
            });
        });

        data.currentPage = page;
        data.hasNextPage = hasNextPage;
        data.total = parseInt(total);
        data.results = results;

        return data;
    } catch (e) {
        console.error("getSearch error:", e.message);
        throw new Error("Failed to search GogoAnime.");
    }
}

async function getAnime(animeid) {
    try {
        const response = await fetchWithFallback(`/category/${animeid}`);
        const html = await response.text();
        const body = cheerio.load(html);

        const data = {};
        const title = body("div.anime_info_body_bg > h1").text();
        const releaseDate = body(
            "div.anime_info_body_bg > p:nth-child(7)"
        ).text();
        const status = body(
            "div.anime_info_body_bg > p:nth-child(9)"
        ).text();
        const otherName = body(
            "div.anime_info_body_bg > p:nth-child(10)"
        ).text();
        const description = body(
            "div.anime_info_body_bg > p:nth-child(8)"
        ).text();
        const image = body("div.anime_info_body_bg > img").attr("src");
        const type = body(
            "div.anime_info_body_bg > p:nth-child(4)"
        ).text();
        const totalEpisodes = body("#episode_page > li").last().find("a").attr("ep_end");

        const genres = [];
        body(
            "div.anime_info_body_bg > p:nth-child(6) > a"
        ).each((i, el) => {
            genres.push(body(el).attr("title"));
        });

        data.id = animeid;
        data.title = title;
        data.url = `${BaseURL}/category/${animeid}`;
        data.image = image;
        data.releaseDate = releaseDate.replace("Released: ", "").trim();
        data.status = status.replace("Status: ", "").trim();
        data.otherName = otherName.replace("Other name: ", "").trim();
        data.description = description.replace("Plot Summary: ", "").trim();
        data.type = type.replace("Type: ", "").trim();
        data.genres = genres;
        data.totalEpisodes = parseInt(totalEpisodes);
        
        // Episodes
        const episodeList = [];
        const ul = body("ul#episode_page").find("li").last();
        const start = ul.find("a").attr("ep_start");
        const end = ul.find("a").attr("ep_end");
        const movie_id = body("#movie_id").attr("value");
        const alias = body("#alias_anime").attr("value");
        
        for (let i = end; i >= start; i--) {
            episodeList.push({
                id: `${alias}-episode-${i}`,
                number: parseInt(i),
                url: `${BaseURL}/${alias}-episode-${i}`,
            });
        }
        data.episodes = episodeList;

        return data;
    } catch (e) {
        console.error("getAnime error:", e.message);
        throw new Error("Failed to get anime details from GogoAnime.");
    }
}

async function getEpisode(animeid) {
    try {
        const response = await fetchWithFallback(`/${animeid}`);
        const html = await response.text();
        const body = cheerio.load(html);

        // --- UPDATED LOGIC TO FIND VIDEO EMBED URL ---
        // GogoAnime now usually hosts the video player inside an iframe called 'default'
        const iframe = body('.anime_video_body iframe#default');
        
        if (iframe.length === 0) {
            throw new Error("Could not find the video player iframe on the episode page.");
        }
        
        let encryptedVideoUrl = iframe.attr('src');
        
        if (!encryptedVideoUrl || !encryptedVideoUrl.includes('id=')) {
            // Fallback for older/alternate layouts, trying to find script directly
            const script = body("div.anime_video_body > script").filter((i, el) => {
                return body(el).html() && body(el).html().includes("Base64.decode");
            }).html();
            
            if (script) {
                const evUrlRegex = /souce_url\s*=\s*['"](.*?)['"];/;
                const evUrlMatch = script.match(evUrlRegex);
                if (evUrlMatch && evUrlMatch.length >= 2) {
                     encryptedVideoUrl = evUrlMatch[1];
                }
            }
            
            if (!encryptedVideoUrl || !encryptedVideoUrl.includes('id=')) {
                throw new Error("Could not extract encrypted video URL from iframe or script.");
            }
        }
        
        const videoId = encryptedVideoUrl.split("?id=")[1].split("&")[0];
        
        const videoResponse = await fetch(encryptedVideoUrl);
        const videoHtml = await videoResponse.text();
        const videoBody = cheerio.load(videoHtml);
        
        const encryptAjaxParams = await generateEncryptAjaxParameters(videoBody, videoId);

        const res = await fetch(
            `${encryptedVideoUrl.split("?")[0].replace("embed", "ajax")}` +
            "?" +
            encryptAjaxParams,
            {
                headers: {
                    "X-Requested-With": "XMLHttpRequest",
                },
            }
        );
        
        const encryptedResponse = await res.json();
        const decryptedResponse = decryptEncryptAjaxResponse(encryptedResponse);

        if (!decryptedResponse.source) {
            throw new Error("Decrypted response missing video sources.");
        }

        const sources = [];
        decryptedResponse.source.forEach((source) => {
            sources.push({
                url: source.file,
                quality: source.label,
                isM3U8: source.file.includes(".m3u8"),
            });
        });
        
        data.sources = sources;
        data.subtitles = []; // Gogoanime does not provide subtitles
        
        return data;
        
    } catch (e) {
        console.error("getEpisode error:", e.message);
        throw new Error("Failed to get episode stream links from GogoAnime. Detail: " + e.message);
    }
}

async function getRecentAnime(page = 1) {
    try {
        const response = await fetchWithFallback(
            `/page-recent-release.html?page=${page}`
        );
        const html = await response.text();
        const body = cheerio.load(html);
        const data = {};
        const results = [];
        let hasNextPage = false;

        // Pagination
        if (body(".pagination-container > ul > li.next").length) {
            hasNextPage = true;
        }

        // Anime listings
        body("div.last_episodes > ul > li").each((i, el) => {
            const anime = body(el).find("p.name > a");
            const img = body(el).find("div > a > img");
            results.push({
                id: anime.attr("href")?.split("/")[1]?.split("-episode-")[0],
                episodeId: anime.attr("href")?.split("/")[1],
                title: anime.attr("title"),
                image: img.attr("src"),
                episodeNumber: parseInt(body(el).find("p.episode").text().replace("Episode ", "").trim()),
                type: body(el).find("p.episode").text().includes("Dub") ? "DUB" : "SUB",
            });
        });

        data.currentPage = page;
        data.hasNextPage = hasNextPage;
        data.results = results;

        return data;
    } catch (e) {
        console.error("getRecentAnime error:", e.message);
        throw new Error("Failed to get recent anime from GogoAnime.");
    }
}

async function getPopularAnime(page = 1) {
    try {
        const response = await fetchWithFallback(
            `/popular.html?page=${page}`
        );
        const html = await response.text();
        const body = cheerio.load(html);
        const data = {};
        const results = [];
        let hasNextPage = false;
        const total = body(".pagination-container > ul > li.selected").text();

        // Pagination
        if (body(".pagination-container > ul > li.next").length) {
            hasNextPage = true;
        }

        // Anime listings
        body("div.last_episodes > ul > li").each((i, el) => {
            const anime = body(el).find("p.name > a");
            const img = body(el).find("div > a > img");
            results.push({
                id: anime.attr("href")?.split("/")[2],
                title: anime.attr("title"),
                image: img.attr("src"),
                releaseDate: body(el).find("p.released").text().trim(),
            });
        });

        data.currentPage = page;
        data.hasNextPage = hasNextPage;
        data.total = parseInt(total);
        data.results = results;

        return data;
    } catch (e) {
        console.error("getPopularAnime error:", e.message);
        throw new Error("Failed to get popular anime from GogoAnime.");
    }
}

async function GogoDLScrapper(animeid, cookie) {
    try {
        // The cookie provided is Base64 encoded, need to decode it
        cookie = atob(cookie);
        const response = await fetchWithFallback("/" + animeid, {
            headers: {
                Cookie: `auth=${cookie}`,
            },
        });
        
        const html = await response.text();
        const body = cheerio.load(html);
        let data = {};
        const links = body("div.cf-download").find("a");
        
        links.each((i, link) => {
            const a = body(link);
            const quality = a.text().trim();
            const url = a.attr("href");
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
        // Fetches a Base64 encoded GogoAnime auth cookie from a GitHub repo
        const response = await fetch(
            "https://api.github.com/repos/TechShreyash/TechShreyash/contents/gogoCookie.txt",
            {
                headers: {
                    "User-Agent": USER_AGENT,
                },
            }
        );
        const data = await response.json();
        const cookie = data["content"].replaceAll("\n", "");
        return cookie;
    } catch (error) {
        console.error("getGogoAuthKey error:", error.message);
        throw new Error("Failed to retrieve GogoAnime authentication key.");
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
};
