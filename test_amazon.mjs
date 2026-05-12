import fetch from 'node-fetch';

const url = "https://www.amazon.in/dp/B0C7J16NYC";

async function testFetch() {
    console.log("Fetching...");
    const res = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_7_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5'
        }
    });
    console.log("Status:", res.status);
    const html = await res.text();
    console.log("Is Blocked by Robot Check?", html.includes("Robot Check") || html.includes("We're sorry"));
    console.log("Length:", html.length);
}
testFetch().catch(console.error);
