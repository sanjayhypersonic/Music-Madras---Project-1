async function main() {
  const url = 'https://yewtu.be/api/v1/videos/zEQmnmwr5UE';
  try {
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      console.log('INVIDIOUS VIDEO STATS:', {
        viewCount: data.viewCount,
        publishedText: data.publishedText,
        published: data.published
      });
    } else {
      console.error('Fetch failed with status:', res.status);
    }
  } catch (err) {
    console.error('Error fetching Invidious:', err);
  }
}
main();
