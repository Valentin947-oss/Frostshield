import { API_URL } from "./chain.js";

async function request(path, { method = "GET", body, apiKey } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(apiKey ? { "x-api-key": apiKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Серверот врати ${res.status}`);
  return data;
}

export const api = {
  forecast: (region) => request(`/api/forecast/${region}`),
  weather: (region, date) => request(`/api/weather/${region}?date=${date}`),
  simulate: (body, apiKey) => request("/api/oracle/simulate", { method: "POST", body, apiKey }),
  report: (body, apiKey) => request("/api/oracle/report", { method: "POST", body, apiKey }),
  timeTravel: (date, apiKey) => request("/api/dev/time", { method: "POST", body: { date }, apiKey }),
  autoClaim: (eventId, apiKey) => request("/api/oracle/auto-claim", { method: "POST", body: { eventId }, apiKey }),
};
