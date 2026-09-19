async function main() {
  try {
    const res = await fetch('https://www.youtube.com/results?search_query=zEQmnmwr5UE', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    const html = await res.text();
    console.log('Results fetched. Length:', html.length);
    
    // Check if we got block page
    if (html.includes('consent.youtube.com')) {
      console.log('Redirected to consent page');
      return;
    }
    
    // Let's write a quick search for view counts and publish dates
    const viewsMatch = html.match(/(\d[\d,\.]*\s*views?)/i);
    const dateMatch = html.match(/(\d+\s+(day|week|month|year)s?\s+ago)/i);
    
    console.log('Views Match:', viewsMatch ? viewsMatch[0] : 'None');
    console.log('Date Match:', dateMatch ? dateMatch[0] : 'None');
  } catch (err) {
    console.error(err);
  }
}
main();
