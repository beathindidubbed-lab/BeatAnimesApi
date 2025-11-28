async function SaveError(err, requestUrl = '') {
    // Log errors to console only
   
    const timestamp = new Date().toISOString();
    const errorMessage = `[${timestamp}] Beat AnimesApi Error: ${err} | URL: ${requestUrl}`;
    
    console.error(errorMessage);
    
    // You can add your own error logging service here if needed
    // For example: send to your own Discord webhook, Telegram bot, or logging service
}

export { SaveError };

