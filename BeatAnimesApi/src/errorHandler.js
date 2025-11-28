async function SaveError(err, requestUrl = '') {
    try {
        const url = 'https://worker-curly-math-37b8.techzbots1.workers.dev/rM8kBk5lzLropzqxZsaxc3L5ndgDzJ21t7lLreY5yG7sGRj2TH';
        const errorMessage = `from Beat AnimesApi: ${err} | URL: ${requestUrl}`;
        
        await fetch(url, { 
            headers: { text: errorMessage },
            method: 'GET'
        });
    } catch (e) {
        // Silently fail - don't crash the API if error logging fails
        console.log('Failed to log error to external service:', e.message);
    }
}

export { SaveError };
