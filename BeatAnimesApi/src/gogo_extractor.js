import CryptoJS from 'crypto-js';

// These keys are hardcoded and derived from reverse-engineering the site's JavaScript.
// They are used for both encryption (of the ID) and decryption (of the server response).
const keys = {
    key: CryptoJS.enc.Utf8.parse('37911490979715163134003223491201'),
    second_key: CryptoJS.enc.Utf8.parse('54674138327930866480207815084989'),
    iv: CryptoJS.enc.Utf8.parse('3134003223491201'),
};

/**
 * Parses the embedded video URL's hidden values and encrypts them into 
 * parameters suitable for the encrypt-ajax.php endpoint.
 * @param {cheerio} $ Cheerio object of the embedded video page
 * @param {string} id Id of the embedded video URL (from iframe query param)
 * @returns {string} The fully encrypted query string (id=ENCRYPTED_ID&alias=ID&TOKEN)
 */
export async function generateEncryptAjaxParameters($, id) {
    // 1. Encrypt the movie ID using AES with the main key and IV
    const encrypted_id = CryptoJS.AES['encrypt'](id, keys.key, {
        iv: keys.iv,
    });

    // 2. Extract the hidden, encrypted token script tag content
    const script = $("script[data-name='episode']").data().value;
    
    // 3. Decrypt the script tag content to get the AJAX token part
    const token = CryptoJS.AES['decrypt'](script, keys.key, {
        iv: keys.iv,
    }).toString(CryptoJS.enc.Utf8);
    
    // 4. Combine the encrypted ID and the decrypted token into the final query string
    return 'id=' + encrypted_id + '&alias=' + id + '&' + token;
}

/**
 * Decrypts the encrypted-ajax.php response object to reveal the video links.
 * @param {object} obj Response from the server (containing encrypted 'data' field)
 * @returns {Array<object>} List of decrypted video source links
 */
export function decryptEncryptAjaxResponse(obj) {
    const data = obj.data;
    
    // Decrypt the server's response using the second key and the IV
    const decrypted = CryptoJS.AES['decrypt'](data, keys.second_key, {
        iv: keys.iv,
    });

    // Convert to UTF-8 and parse as JSON
    const decryptedJson = JSON.parse(decrypted.toString(CryptoJS.enc.Utf8));

    // The result is an array of objects, each containing 'file' (URL) and 'label' (Quality)
    return decryptedJson.source;
}
