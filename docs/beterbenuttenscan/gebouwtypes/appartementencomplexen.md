# Appartementencomplexen

## Definitie

De laag appartementencomplexen bevat geaggregeerde BAG Pand objecten en kan gebruikt worden voor de verdichtingsvormen optoppen, aanplakken en uitplinten. De laag is geaggregeerd omdat de BAG Pand objecten niet altijd overeenkomen met de manier waarop wij een appartementencomplex zien.

Als we bijv. de [definitie opzoeken van objecttype Pand in de BAG](https://imbag.github.io/praktijkhandleiding/beslisboomvragen_pand/pand-07):
> *Een pand moet ondeelbaar zijn en mag bij de totstandkoming niet kunnen worden opgedeeld in kleinere eenheden die elk afzonderlijk aan de definitie van een pand voldoen.*
> 

Dit zorgt ervoor dat een portiekflat volgens deze definitie wordt opgesplitst in meerdere BAG Pand objecten, terwijl de potentie van een optopproject sterk afhankelijk is van het aantal potentieel te realiseren woningen op een appartementencomplex. Daarom is de keuze gemaakt om BAG Pand objecten te aggregreren met als doel om een betere representatie van de werkelijkheid te krijgen.

De manier van aggregatie is:

1. We selecteren eerst panden met een woonfunctie en groeperen de panden die vlak naast elkaar staan (binnen 2,5 meter) tot één aaneengesloten geheel. 
2. Vervolgens bepalen we of deze groep een appartementencomplex is op basis van het aantal woningen: een losstaand gebouw moet meer dan drie woningen bevatten, en een groep van meerdere panden moet gemiddeld meer dan 1,2 woningen per pand hebben.

<details markdown="1">
<summary>Toon SQL-query</summary>

Wij gebruiken de volgende SQL query om de appartementencomplexen te selecteren:

```sql title="SQL query voor het selecteren van appartementencomplexen"
select
	a.cid as cid,
	a.oorspronkelijk_bouwjaar,
    a.gerelateerdepanden as gerelateerdepanden,
	a.a_vb as a_vb,
	a.a_vb_wf as a_vb_wf,
	a.a_p as a_p,
	ST_SetSRID(a.geometrie, 7415) as geometrie
from (
        select
            b.cid,
            min(b.oorspronkelijk_bouwjaar) as oorspronkelijk_bouwjaar,
            array_agg(b.identificatie) as gerelateerdepanden, 
            sum(b.a_vb) as a_vb,
            sum(b.a_vb_wf) as a_vb_wf,
            count(b.fid) as a_p,
            ST_Buffer(ST_Buffer(ST_Union(b.geometrie), 1, 'join=mitre'), -1, 'join=mitre') as geometrie
        from
            (
            WITH gebied_union AS (
        SELECT ST_Union(ST_SetSRID(geometrie, 7415)) AS gemeente_geom
        FROM brondata.gemeentegebied
            WHERE ligt_in_provincie_naam = :provincie OR naam = :gemeente
    )
    SELECT
        pa.identificatie,
        pa.fid,
        MIN(pa.oorspronkelijk_bouwjaar) AS oorspronkelijk_bouwjaar,
        ST_ClusterDBSCAN(pa.geometrie, eps := 2.5, minpoints := 1) OVER () AS cid,
        count(st_contains(pa.geometrie, vb.geopunt)) as a_vb,
        COUNT(*) FILTER (WHERE 'woonfunctie' = ANY(vb.gebruiksdoelverblijfsobject)) AS a_vb_wf,
        pa.geometrie
    FROM brondata.bag3d_pand_nl AS pa
    JOIN brondata.bag_verblijfsobject_nl AS vb
        ON ST_Contains(pa.geometrie, vb.geopunt)
    JOIN gebied_union
        ON ST_Intersects(pa.geometrie, gebied_union.gemeente_geom)
    WHERE
        pa.oorspronkelijk_bouwjaar > 1945
        AND pa.oorspronkelijk_bouwjaar < 1992
        AND (ST_Area(pa.geometrie) + 10) > vb.oppervlakteverblijfsobject
    GROUP BY
        pa.fid, pa.identificatie, pa.geometrie
		) as b
	group by b.cid
	) as a
where
	(a.a_p = 1 and (a.a_vb_wf/a.a_p) > 3)
	OR
	(a.a_p > 1 and (a.a_vb_wf/a.a_p) > 1.2) 
    AND a.cid IS NOT NULL
```
</details>

## Criteria
Onderstaand de criteria die gebruikt worden om de potentie van een appartementencomplex te beoordelen. 
### Fundering
De funderingsscore combineert het oorspronkelijk bouwjaar en de kwetsbaarheid van het bodemtype.  
Gebouwen van vóór 1970 hebben een hoger risico. Bodemtypes klei en veen verhogen het risico op funderingsrot of verzakking. Meer risico betekent een lagere score.

gebruikte data: [BAG Pand](https://imbag.github.io/praktijkhandleiding/objecttypen/pand), [Indicatieve aandachtsgebieden funderingsproblematiek](https://service.pdok.nl/rvo/indicatieve-aandachtsgebieden-funderingsproblematiek/atom/index.xml)

<details markdown="1">
<summary>Technische uitleg</summary>


1. Per complex (`complexid`) het gewogen gemiddelde van het oorspronkelijke bouwjaar berekend.
2. De complexen worden verrijkt met funderings- en bodemdata (waaronder het bodemtype en het percentage overlap met dat bodemtype, `perc_fgr`). Binnen een complex wordt het record met het hoogste percentage per bodemtype behouden.
4. Berekenen van de deelfactoren:
   * Bodemscore:*
     * Ligt het complex in een *'Kwetsbaar gebied'*? Dan krijgt het een score die lineair afneemt naarmate het percentage van het complex dat op deze kwetsbare bodem ligt (`perc_fgr`) groter is.
     * Ligt het in een *'Niet kwetsbaar gebied'* of is de status *'onbekend - stedelijk gebied'*? Dan is de bodemscore standaard 1.
   * Bouwjaarscore:
     * Pandeigenschappen van vóór 1970 worden als risicovoller gezien en krijgen een score van 0.5. 
     * Panden uit 1970 of later krijgen een score van 1.
5. Eindscore berekenen: De uiteindelijke funderingsscore is de vermenigvuldiging van de bouwjaarscore en de bodemscore. Dit getal wordt afgerond op twee decimalen.

### Wiskundige Notatie

De uiteindelijke funderingsscore ($S_{fundering}$) wordt berekend door de bouwjaarscore ($S_{bouwjaar}$) te vermenigvuldigen met de bodemscore ($S_{bodem}$):

$$S_{fundering} = \text{round}(S_{bouwjaar} \times S_{bodem}, 2)$$

Hierbij wordt de **bouwjaarscore** als volgt bepaald aan de hand van het gewogen gemiddelde bouwjaar ($B$) van het complex:

$$S_{bouwjaar} = \begin{cases} 0.5 & \text{als } B < 1970 \\ 1 & \text{als } B \ge 1970 \end{cases}$$

De **bodemscore** hangt af van de bodemcategorie en het percentage van het complex dat binnen dat gebied valt ($P_{fgr}$):

$$S_{bodem} = \begin{cases} 1 - 0.5 \times \left( \frac{P_{fgr}}{100} \right) & \text{als bodem} = \text{"Kwetsbaar gebied"} \\ 1 & \text{als bodem} \in \{ \text{"Niet kwetsbaar", "Onbekend - stedelijk"} \} \end{cases}$$

</details>

**Update:** we zijn in gesprek met [fundermaps](https://fundermaps.com/) om samen dit criteria te verbeteren.

### Gebouwtype


### Daktype
De daktypescore kijkt naar het aantal dakvlakken en de hellingshoeken daarvan.  
Hoe minder dakvlakken en hoe flauwer de helling, hoe hoger de potentie voor optoppen en dus hoe hoger de score.

### Dakoppervlakte
De score voor plat dakoppervlakte neemt toe naarmate het platte dak groter is.  
Vanaf circa **300 m²** plat dakoppervlakte is optoppen doorgaans goed inpasbaar.

### Vrij dakpercentage
Dit criterium geeft aan welk deel van het dak vrij en bruikbaar is voor toevoeging van bouwvolume. Een hoger vrij dakpercentage betekent meer effectieve ruimte en een hogere score. We kijken hiervoor met beeldherkenning naar de aanwezigheid van obstakels zoals dakkapellen, schoorstenen, zonnepanelen en installaties.

### Beschikbare bouwhoogte
Dit is de vrijehoogtescore: hoeveel verticale ruimte is er nog beschikbaar voor optoppen?  
De score is gebaseerd op het verschil tussen de maximale bouwhoogte uit het bestemmingsplan en de huidige bouwhoogte, en staat gelijk aan het **percentage dakoppervlakte met meer dan 3 meter vrije ruimte**.

### Bestaande bouwhoogte
Hoe hoger het bestaande gebouw, hoe lager de score.  
Bij grotere hoogtes is de constructieve marge vaak kleiner en gelden strengere bouwkundige voorschriften. De score verloopt lineair tussen **0 en 30 meter** (hoger is slechter).

### Vrije ruimte perceel
Dit criterium beoordeelt hoeveel horizontale ruimte rondom het complex beschikbaar is. Dat zegt iets over:

- ruimte voor een nieuwe ontsluiting (trappenhuis/lift)
- mogelijkheid voor extra parkeerplaatsen op eigen terrein
- kans op extra schaduwval op omliggende bebouwing
- ruimte voor bouwplaatsinrichting

De score verloopt lineair tussen **1000 en 5000 m²**; meer ruimte is beter.

### Energielabel
De energielabelscore geeft aan hoeveel verduurzamingspotentie er nog in een complex zit bij een optopproject. Hoe beter het huidige label, hoe lager de score: bij een al energiezuinig gebouw is de extra winst van een gecombineerd renovatie- en optoptraject doorgaans kleiner.

Voor een complex met meerdere panden bepalen we eerst één representatief energielabel op complexniveau. Daarbij gebruiken we de meest voorkomende energieklasse binnen het complex, zodat incidentele uitzonderingen minder zwaar wegen dan het dominante beeld. Als er geen bruikbaar label beschikbaar is, wordt het bouwjaar meegewogen als vangnet om oudere complexen niet ten onrechte gunstig te laten scoren.

Technisch wordt in FME per `complexid` met een `StatisticsCalculator` de **mode** van `energieklasse` berekend (`energieklasse.mode`) en via `FeatureJoiner` teruggezet op het complex. Daarna zet de `AttributeManager` dit om naar `energielabel` en rekent `energielabel_score` uit. Met \(L=\text{energielabel}\) en \(Y=\text{oorspronkelijkbouwjaar.mean}\) is de scoring:

\[
\mathrm{energielabel\_score}(L,Y)=
\begin{cases}
0   & \text{als } L=\mathrm{A}\\
0.2 & \text{als } L=\mathrm{B}\\
0.4 & \text{als } L=\mathrm{C}\\
0.6 & \text{als } L=\mathrm{D}\\
0.8 & \text{als } L=\mathrm{E}\\
1   & \text{als } L\in\{\mathrm{F},\mathrm{G}\}\\
1   & \text{als } L\text{ ontbreekt en }Y\le 1992\\
0   & \text{anders}
\end{cases}
\]

In de eindoutput blijven alleen `energielabel_score`, `complexid` en `energielabel` over.

### Eigendomssituatie
Dit is de eigenarenscore: hoe meer belangen, hoe complexer de besluitvorming en onderhandelingen.  
De score verloopt lineair tussen **0 en 10 eigenaren**, waarbij meer eigenaren slechter scoren.

### Plintfunctie
De plintfunctie wordt als contextcriterium meegenomen om de huidige functiemix te begrijpen. Het helpt bij de ruimtelijke en programmatische afweging rond optoppen.


## Attributen

| Naam | Voorbeeldwaarde | Uitleg |
|---|---:|---|
| Bouwjaar | 1984 | Jaar waarin het gebouw is opgeleverd/gebouwd. |
| Energielabel | C | Energieprestatieklasse van het gebouw. |
| Monumentstatus | No | Geeft aan of het gebouw een monument is. |
| Erfpacht |  | Type of status van erfpacht op de grond. |
| Einddatum Erfpacht |  | Einddatum van het erfpachtrecht (indien van toepassing). |
| Provincie | Voorbeeldland | Provincie waarin het object ligt. |
| Gemeente | Voorbeeldstad | Gemeente waarin het object ligt. |
| Wijk | Wijk 03 Centrum | Wijkindeling van de locatie. |
| Buurt | Jan de Vriesplein en omgeving | Buurtindeling van de locatie. |
| Gebouwtype | Appartement | Type gebouw/gebruiksfunctie op hoofdniveau. |
| Gebouwhoogte | 10.2 | Hoogte van het gebouw (meestal in meters). |
| Daktype | schuin/speciaal | Type dakvorm van het gebouw. |
| Plat dak oppervlakte | 892 | Oppervlakte van platte dakdelen (meestal m²). |
| Percentage vrij dak | 96 | Aandeel van het dak dat vrij/bruikbaar is (in %). |
| Vrije ruimte perceel | 1580 | Beschikbare onbebouwde ruimte op het perceel (meestal m²). |
| Bodemtype | Niet indeelbaar | Classificatie van de ondergrond/bodem. |
| Deelautos | 8 | Aantal deelauto’s in de omgeving of gekoppeld aan het object. |
| Aantal woningen | 32 | Totaal aantal woningen in het gebouw/complex. |
| Oppervlakte wonen | 1991 | Totale vloeroppervlakte met woonfunctie (meestal m²). |
| Percentage wonen | 99 | Aandeel woonfunctie in de totale gebruiksoppervlakte (in %). |
| Oppervlakte winkels | 11 | Totale vloeroppervlakte met winkelfunctie (m²). |
| Percentage winkels | 1 | Aandeel winkelfunctie in de totale gebruiksoppervlakte (in %). |
| Oppervlakte zorg | 0 | Totale vloeroppervlakte met zorgfunctie (m²). |
| Percentage zorg | 0 | Aandeel zorgfunctie in de totale gebruiksoppervlakte (in %). |
| Oppervlakte kantoor | 0 | Totale vloeroppervlakte met kantoorfunctie (m²). |
| Percentage kantoor | 0 | Aandeel kantoorfunctie in de totale gebruiksoppervlakte (in %). |
| Oppervlakte overig | 0 | Totale vloeroppervlakte van overige functies (m²). |
| Percentage overige functies | 0 | Aandeel overige functies in de totale gebruiksoppervlakte (in %). |
| Naam vve | Vereniging van Eigenaars Gebouw Jan de Vriesplein 12-34 te Voorbeeldstad | Officiële naam van de VvE die het gebouw beheert. |
| Aantal stakeholders woningen | 32 | Aantal betrokken eigenaren/partijen voor de woningen. |
| Particuliere koop aantal | 25 | Aantal woningen in particulier eigendom. |
| Particuliere koop percentage | 1 | Aandeel particulier eigendom binnen woningvoorraad (bronafhankelijk: % of fractie). |
| Woningcorporatie aantal | 0 | Aantal woningen in eigendom van woningcorporaties. |
| Woningcorporatie percentage | 0 | Aandeel corporatiebezit binnen woningvoorraad. |
| Overige verhuur aantal | 5 | Aantal woningen in overige verhuurcategorieën. |
| Overige verhuur percentage | 0 | Aandeel overige verhuur binnen woningvoorraad. |
| Overige onbekend aantal | 2 | Aantal woningen met onbekende/overige eigendomscategorie. |
| Overig onbekend percentage | 0 | Aandeel onbekende/overige eigendomscategorie. |
| Complex ID | 90231 | Unieke identificatie van het complex in de dataset. |
| Aantal stakeholders totaal | 32 | Totaal aantal stakeholders over alle categorieën. |