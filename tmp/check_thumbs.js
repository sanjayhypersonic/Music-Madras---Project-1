import fs from 'fs';

const data = fs.readFileSync('src/data.ts', 'utf8');
const idMatches = [...data.matchAll(/youtubeId:\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
console.log(`Found ${idMatches.length} videos`);

async function testAll() {
  const results = await Promise.all(idMatches.map(async (id) => {
    try {
      const maxres = `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
      const hq = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
      const mq = `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
      const [rMax, rHq, rMq] = await Promise.all([
        fetch(maxres).then(r => r.status),
        fetch(hq).then(r => r.status),
        fetch(mq).then(r => r.status)
      ]);
      return { id, maxres: rMax, hq: rHq, mq: rMq };
    } catch (e) {
      return { id, error: e.message };
    }
  }));

  const maxresOk = results.filter(r => r.maxres === 200).length;
  const hqOk = results.filter(r => r.hq === 200).length;
  const mqOk = results.filter(r => r.mq === 200).length;
  console.log(`maxresdefault (720p) OK: ${maxresOk}/${results.length}`);
  console.log(`hqdefault (480p) OK: ${hqOk}/${results.length}`);
  console.log(`mqdefault (360p) OK: ${mqOk}/${results.length}`);
  results.filter(r => r.maxres !== 200).forEach(r => console.log('Missing maxres:', r.id, r.maxres));
}

testAll();
