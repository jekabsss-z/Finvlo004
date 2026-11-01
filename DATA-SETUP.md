# Market Data Setup

The site bundles clearly labeled fictional data so the research screens work without credentials. It also supports local CSV imports. For automatic provider refresh, deploy the Vercel function in `api/market-data.js` and configure a Financial Modeling Prep account with access to the endpoints you enable.

## Configure the API key

1. Create an FMP account and check the plan's access and redistribution terms for quote, profile, and historical EOD endpoints. The API key is private; do not put it in `script.js`, an HTML file, or any `VITE_` variable.
2. In Vercel, open the project settings and add `FMP_API_KEY` as an environment variable for Preview and Production.
3. Deploy the site. Vercel serves `api/market-data.js` as `/api/market-data`.
4. Open a stock or fund detail page and press **Refresh daily data**. On a hosted page, the app checks cached provider data on page load and refreshes it when older than one hour. The history endpoint returns daily EOD data; the quote endpoint may have different delays depending on your provider plan and exchange permissions.
5. For local API testing, use Vercel's development server (`vercel dev`) with `FMP_API_KEY` set in your local environment. Opening `index.html` with a `file://` URL supports CSV import but cannot call the server function.

The API function requests a quote, a security profile for stocks, and up to five years of daily EOD prices. A plan may grant only some endpoints; the UI reports whether it received a quote, profile, and daily history. It does not silently treat missing API data as live. The app refreshes on asset-page visits or when the user requests it; it does not run a background scheduled job while nobody is using the site.

## Import manually

From the Stocks or Funds explorer, download the CSV template and fill it with values you are licensed to use. The stock template accepts `symbol,price,currency,marketcap,roic,revenue,fcf,source,asof`. The fund template accepts `symbol,nav,currency,assets,count,yield,fee,return,source,asof`. Importing updates matching assets in this browser only. Stock detail pages also allow editing the full quality-metric set; fund detail pages allow editing NAV and holding weights/quality assumptions.

All imported facts should carry a source and as-of date in a production version. CSV imports do not verify accuracy, and the sample quality scores are not a production peer ranking.
