import {
    generateEncryptAjaxParameters,
    decryptEncryptAjaxResponse,
} from "./gogo_extractor.js";
import cheerio from "cheerio";

// UPDATED: Try multiple working GogoAnime domains
const GOGO_DOMAINS = [
    "https://anitaku.pe",      // Current working domain
    "https://gogoanime3.co",   // Backup
    "https://gogoanime.hu",    // Backup
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
            const response = await fetch(url, {
                ...options,
                headers: {
                    "User-Agent": USER_AGENT,
                    ...options.headers
                }
            });
            
            if (response.ok) {
                BaseURL = domain; // Update to working domain
                return response;
            }
        } catch (error) {
            lastError = error;
            console.log(`Failed to fetch from ${domain}: ${error.message}`);
        }
    }
    
    throw lastError || new Error("All GogoAnime domains failed");
}

async function getSearch(name, page = 1) {
    try {
        const response = await fetchWithFallback(
            "/search.html?keyword=" + encodeURIComponent(name) + "&page=" + page
        );
        
        let html = await response.text();
        let $ = cheerio.load(html);
        const searchResults = [];

        $("ul.items li").each(function (i, elem) {
            let anime = {};
            $ = cheerio.load($(elem).html());
            anime.title = $("p.name a").text() || null;
            anime.img = $("div.img a img").attr("src") || null;
            anime.link = $("div.img a").attr("href") || null;
            anime.id = anime.link ? anime.link.split("/category/")[1] : null;
            anime.releaseDate = $("p.released").text().trim() || null;
            if (anime.link) anime.link = BaseURL + anime.link;

            if (anime.id) {
                searchResults.push(anime);
            }
        });

        return searchResults;
    } catch (error) {
        console.error("getSearch error:", error.message);
        return [];
    }
}

async function getAnime(id) {
    try {
        let response = await fetchWithFallback("/category/" + id);
        let html = await response.text();
        let $ = cheerio.load(html);
        
        let animeData = {
            name: $("div.anime_info_body_bg h1").text() || "Unknown",
            image: $("div.anime_info_body_bg img").attr("src") || "",
            id: id,
        };

        $("div.anime_info_body_bg p.type").each(function (i, elem) {
            const $x = cheerio.load($(elem).html());
            let keyName = $x("span")
                .text()
                .toLowerCase()
                .replace(":", "")
                .trim()
                .replace(/ /g, "_");
            if (/released/g.test(keyName))
                animeData[keyName] = $(elem)
                    .html()
                    .replace(`<span>${$x("span").text()}</span>`, "")
                    .trim();
            else animeData[keyName] = $x("a").text().trim() || null;
        });

        animeData.plot_summary = $("div.description").text().trim() || "No description available";

        const animeid = $("input#movie_id").attr("value");
        
        if (animeid) {
            response = await fetch(
                "https://ajax.gogocdn.net/ajax/load-list-episode?ep_start=0&ep_end=1000000&id=" + animeid,
                { headers: { "User-Agent": USER_AGENT } }
            );
            html = await response.text();
            $ = cheerio.load(html);

            let episodes = [];
            $("ul#episode_related a").each(function(i, elem) {
                const name = $(elem)
                    .find("div")
                    .text()
                    .trim()
                    .split(" ")[1]
                    .slice(0, -3);
                const link = $(elem).attr("href").trim().slice(1);
                if (name && link) {
                    episodes.push([name, link]);
                }
            });
            
            animeData.episodes = episodes.reverse();
        } else {
            animeData.episodes = [];
        }

        return animeData;
    } catch (error) {
        console.error("getAnime error:", error.message);
        throw error;
    }
}

async function getRecentAnime(page = 1) {
    try {
        const response = await fetchWithFallback("/?page=" + page);
        let html = await response.text();
        let $ = cheerio.load(html);
        const recentAnime = [];

        $("ul.items li").each(function (i, elem) {
            $ = cheerio.load($(elem).html());
            const anime = {
                title: $("p.name a").text() || null,
                episode: $("p.episode").text() || null,
                image: $("div.img img").attr("src") || null,
                link: BaseURL + $("div.img a").attr("href") || null,
                id: $("div.img a").attr("href") ? $("div.img a").attr("href").split("/")[1] : null,
            };
            
            if (anime.id) {
                recentAnime.push(anime);
            }
        });
        
        return recentAnime;
    } catch (error) {
        console.error("getRecentAnime error:", error.message);
        return [];
    }
}

async function getPopularAnime(page = 1, max = 10) {
    try {
        const response = await fetchWithFallback("/popular.html?page=" + page.toString());
        let html = await response.text();
        let $ = cheerio.load(html);
        const popularAnime = [];

        $("ul.items li").each(function (i, elem) {
            $ = cheerio.load($(elem).html());
            const anime = {
                title: $("p.name a").text() || null,
                releaseDate:
                    $("p.released").text().replace("Released:", "").trim() || null,
                image: $("div.img img").attr("src") || null,
                link: BaseURL + $("div.img a").attr("href") || null,
                id: $("div.img a").attr("href") ? $("div.img a").attr("href").split("/category/")[1] : null,
            };
            
            if (anime.id) {
                popularAnime.push(anime);
            }
        });
        
        return popularAnime.slice(0, max);
    } catch (error) {
        console.error("getPopularAnime error:", error.message);
        return [];
    }
}

async function getEpisode(id) {
    try {
        const link = `${BaseURL}/${id}`;

        const response = await fetchWithFallback("/" + id);
        let html = await response.text();
        let $ = cheerio.load(html);
        
        const episodeCount = $("ul#episode_page li a.active").attr("ep_end") || "0";
        const iframe = $("div.play-video iframe").attr("src");
        const serverList = $("div.anime_muti_link ul li");
        const servers = {};
        
        serverList.each(function (i, elem) {
            elem = $(elem);
            if (elem.attr("class") != "anime") {
                const className = elem.attr("class");
                const dataVideo = elem.find("a").attr("data-video");
                if (className && dataVideo) {
                    servers[className] = dataVideo;
                }
            }
        });

        let m3u8 = null;
        
        if (iframe) {
            try {
                m3u8 = await getM3U8(iframe);
            } catch (e) {
                console.log("Failed to get M3U8:", e.message);
            }
        }

        const ScrapedAnime = {
            name:
                $("div.anime_video_body h1")
                    .text()
                    .replace("at gogoanime", "")
                    .trim() || null,
            episodes: episodeCount,
            stream: m3u8,
            servers,
        };

        return ScrapedAnime;
    } catch (error) {
        console.error("getEpisode error:", error.message);
        throw error;
    }
}

async function getM3U8(iframe_url) {
    let sources = [];
    let sources_bk = [];
    let serverUrl = new URL(iframe_url);
    
    const goGoServerPage = await fetch(serverUrl.href, {
        headers: { "User-Agent": USER_AGENT },
    });
    const $$ = cheerio.load(await goGoServerPage.text());

    const params = await generateEncryptAjaxParameters(
        $$,
        serverUrl.searchParams.get("id")
    );

    const fetchRes = await fetch(
        `${serverUrl.protocol}//${serverUrl.hostname}/encrypt-ajax.php?${params}`,
        {
            headers: {
                "User-Agent": USER_AGENT,
                "X-Requested-With": "XMLHttpRequest",
            },
        }
    );

    const res = decryptEncryptAjaxResponse(await fetchRes.json());
    
    if (res.source) {
        res.source.forEach((source) => sources.push(source));
    }
    if (res.source_bk) {
        res.source_bk.forEach((source) => sources_bk.push(source));
    }

    return {
        Referer: serverUrl.href,
        sources: sources,
        sources_bk: sources_bk,
    };
}

async function GogoDLScrapper(animeid, cookie) {
    try {
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
};
