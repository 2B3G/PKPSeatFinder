// server.js
const express = require("express");
const axios = require("axios");
const { writeFileSync, appendFileSync, readFileSync } = require("node:fs");

const app = express();
app.use(express.json());
app.use(express.static("public")); // frontend w folderze public

function getFormattedDate() {
  const now = new Date();

  const pad = (n, width = 2) => String(n).padStart(width, "0");

  return (
    now.getFullYear() +
    "-" +
    pad(now.getMonth() + 1) +
    "-" +
    pad(now.getDate()) +
    " " +
    pad(now.getHours()) +
    ":" +
    pad(now.getMinutes()) +
    ":" +
    pad(now.getSeconds()) +
    "." +
    pad(now.getMilliseconds(), 3)
  );
}

// pobieranie stacji
app.get("/api/stations", async (req, res) => {
  try {
    const stationsResp = await axios.post(
      "https://api-gateway.intercity.pl/server/public/endpoint/Aktualizacja",
      {
        metoda: "pobierzStacje",
        ostatniaAktualizacjaData: getFormattedDate(),
        urzadzenieNr: 956,
      },
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0",
        },
      }
    );

    writeFileSync("config.json", JSON.stringify(stationsResp.data.stacje));

    const stations = Object.values(stationsResp.data.stacje).map((s) => ({
      name: s.nazwa,
      stationCode: s.kodEVA,
    }));

    res.json(stations);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Nie udało się pobrać stacji" });
  }
});

// so now if
async function isTicketValid(ticket) {
  const stations = JSON.parse(readFileSync("config.json").toString());

  // For each train (segment) inside the ticket
  const checks = await Promise.all(
    ticket.pociagi.map(async (pociag, i) => {
      try {
        const startStationCode = stations.filter(
          (s) => s.kod == pociag.stacjaWyjazdu
        )[0].kodEPA;

        const destStationCode = stations.filter(
          (s) => s.kod == pociag.stacjaPrzyjazdu
        )[0].kodEPA;

        const resp = await axios.get(
          `https://api-gateway.intercity.pl/availability/frequency/${
            pociag.kategoriaPociagu
          }/${pociag.nrPociagu}/${pociag.dataWyjazdu.replace(
            " ",
            "T"
          )}/${pociag.dataPrzyjazdu.replace(
            " ",
            "T"
          )}/${startStationCode}/${destStationCode}/`,
          {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0",
            },
          }
        );

        const data = resp.data;

        const hasSeats = data.CLASS2.some(
          (seat) =>
            seat.serviceType === "SEAT" &&
            seat.type === "COMMON" &&
            seat.noOfAvailableSpots > 0
        );

        return hasSeats;
      } catch (err) {
        console.error(
          `❌ Error checking availability for train ${pociag.nrPociagu}:`,
          err.message
        );
        return false; // if request fails, treat as invalid
      }
    })
  );

  // Ticket is valid only if *all trains* have available seats
  return checks.every((result) => result === true);
}

// pobieranie połączeń
app.post("/api/connections", async (req, res) => {
  const { start, end, date } = req.body;

  const { startStationCode } = start;
  const { stationCode } = end;

  const payload = {
    urzadzenieNr: 956,
    metoda: "wyszukajPolaczenia",
    dataWyjazdu: `${date} 00:00:00`,
    dataPrzyjazdu: `${date} 23:59:59`,
    stacjaWyjazdu: startStationCode,
    stacjaPrzyjazdu: parseInt(stationCode),
    stacjePrzez: [],
    polaczeniaNajszybsze: 0,
    liczbaPolaczen: 0,
    czasNaPrzesiadkeMax: 1440,
    liczbaPrzesiadekMax: 2,
    polaczeniaBezposrednie: 0,
    kategoriePociagow: ["EIP", "EIC", "IC", "TLK", "ZKA"],
    kodyPrzewoznikow: [],
    rodzajeMiejsc: [],
    typyMiejsc: [],
    braille: 0,
    czasNaPrzesiadkeMin: 5,
    atrybutyHandlowe: [],
    wersja: "1.2.2_desktop",
    url: `https://ebilet.intercity.pl/wyszukiwanie?dwyj=${date}&swyj=${startStationCode}&sprzy=${stationCode}&time=00:00`,
  };

  try {
    const tickets = await axios.post(
      "https://api-gateway.intercity.pl/server/public/endpoint/Pociagi",
      payload,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0",
        },
      }
    );

    const data = (
      await Promise.all(
        tickets.data.polaczenia.map(async (conn) => {
          if (await isTicketValid(conn)) {
            return {
              wyjazd: conn.dataWyjazdu,
              przyjazd: conn.dataPrzyjazdu,
              czas: conn.czasJazdy,
            };
          }
          return [];
        })
      )
    ).flat();

    res.json(data);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: "Nie udało się pobrać połączeń" });
  }
});

const PORT = 3000;
app.listen(PORT, () =>
  console.log(`🚂 Server running on http://localhost:${PORT}`)
);
