# Fixtures

Påhittade flöden med **samma form** som de verkliga. Namn, lag och adresser är utbytta; struktur,
tidszon, fältordning och textmönster kommer från ett skarpt Sportadmin-flöde hämtat 2026-10-29
(86 händelser, `TZID=Europe/Stockholm`, `Samling: HH:MM` först i `DESCRIPTION`, 11 tomma
beskrivningar, ingen `RRULE`).

Ingen riktig personuppgift finns i filerna. Det är avsiktligt: de hamnar i git.

## sportadmin-barn1.ics

Bandylag P16. Nio händelser i november 2026, och varje kantfall som bevisligen förekommer:

| Händelse | Kantfall |
|---|---|
| 3 nov, träning | samling i beskrivningen, `LOCATION` satt |
| 5 nov, träning | samling följd av `\n` och mer text |
| 10 nov, träning | tom `DESCRIPTION` → ingen samling, ingen gissning |
| 14 nov, match | `Match: … - …` → motståndare, samling 09:15 |
| 17 nov, träning | `STATUS:CANCELLED` → ska visas som inställd |
| 21 nov, match | ingen `LOCATION`-rad alls → ingen restid, ingen transportkrock |
| 24 nov, träning | lång beskrivning med emoji och `\n` |
| 1 nov, serie | `RRULE:FREQ=WEEKLY;COUNT=4` → fyra instanser |
| 16 nov, flyttad | `RECURRENCE-ID` flyttar 15 nov till 16 nov |

## sportadmin-barn2.ics

Innebandylag F14. Fem händelser, varav två på samma plats samma dag (14 nov) — de ska **inte**
krocka med varandra, men båda med Barn 1:s match i Kärrtorp.

## Krocken som filerna bevisar

Lördag 14 november: Barn 1 har match 10:00 på Kärrtorps IP med samling 09:15, Barn 2 har sammandrag
10:15 i Äppelviksskolan med samling 09:30. Tiderna överlappar, platserna ligger en bilresa ifrån
varandra, och krocken är olöst tills någon tar ansvar.

## Att lägga till när SvenskaLag-flödet finns

Samma sorts fil för SvenskaLag. Tills dess testas bara de fall som Sportadmin visat plus de
konstruerade kantfallen ovan.
