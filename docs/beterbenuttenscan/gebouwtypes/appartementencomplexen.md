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
Portiek- en galerijflats hebben vaak een gestandaardiseerde en repeterende opbouw. Daardoor kan de bestaande ontsluiting in veel gevallen relatief eenvoudig worden doorgetrokken naar een nieuwe optoplaag. Om die reden achten we bij deze gebouwtypen de kansen voor optoppen hoger. Bij overige appartementen en flatwoningen is de kans gemiddeld, terwijl logieswoningen en maisonnettes een lagere score krijgen.

De gebouwtypen zijn afkomstig uit de energielabeldataset en worden waar mogelijk aangevuld met gegevens uit EP-online. Voor een complex met meerdere panden bepalen we eerst het meest voorkomende gebouwtype. Zo voorkomen we dat een incidenteel afwijkend type de score van het hele complex bepaalt. Als er geen gebouwtype beschikbaar is, wordt de waarde als *onbekend* geregistreerd.

De gebouwtypescore wordt als volgt toegekend:

| Gebouwtype | Score |
|---|---:|
| Galerij, galerijwoning, woongebouw met niet-zelfstandige woonruimte, portiekwoning | 1 |
| Appartement, flatwoning (overig) | 0,75 |
| Logieswoning, maisonnette | 0,5 |
| Rijwoning tussen, twee-onder-een-kap, vrijstaande woning, rijwoning hoek, twee-onder-een-kap/rijwoning hoek | 0 |
| Onbekend | 0 |

<details markdown="1">
<summary>Technische uitleg</summary>

Voor ieder appartementencomplex \(c\) bepalen we eerst het representatieve gebouwtype op basis van de gebouwtypen van de onderliggende panden:

$$
T_c = \operatorname{median}_{\mathrm{lex}}\left(\{t_i \mid i \in c\}\right)
$$

Hierbij is \(t_i\) het gebouwtype van pand \(i\) en wordt de mediaan bepaald op basis van de alfabetische volgorde van de gebouwtypen. De gebouwtypescore \(S_{\mathrm{gebouwtype}}\) wordt vervolgens bepaald met:

$$
S_{\mathrm{gebouwtype}}(T_c) =
\begin{cases}
1 & \text{als } T_c \in \{\text{Galerij, Galerijwoning, Woongebouw met niet-zelfstandige woonruimte, Portiekwoning}\} \\
0.75 & \text{als } T_c \in \{\text{Appartement, Flatwoning (overig)}\} \\
0.5 & \text{als } T_c \in \{\text{Logieswoning, Maisonnette}\} \\
0 & \text{als } T_c \text{ ontbreekt of een grondgebonden woningtype is}
\end{cases}
$$

Technisch wordt in FME met een `StatisticsCalculator` per `complexid` de mediaan van `gebouwtype` bepaald. Omdat gebouwtype een categorische waarde is, wordt hiermee het middelste alfabetische type geselecteerd. Via een `FeatureJoiner` wordt deze waarde teruggezet op het complex. Daarna zet de `AttributeManager` de waarde om naar `gebouwtype` en wordt met een `AttributeValueMapper` de `gebouwtype_score` berekend.

</details>

**Update: **We onderzoeken momenteel of beeldherkenning kan worden ingezet om de kwaliteit van de onderliggende gebouwtypegegevens verder te verbeteren. Daarbij kijken we onder meer naar de herkenning van type gevelmateriaal, buitenruimte en ontsluiting.

### Daktype
De daktypescore geeft aan hoe geschikt de dakopbouw is voor optoppen. Hoe groter het aandeel platte dakvlakken en hoe kleiner het hoogteverschil tussen deze dakvlakken, hoe hoger de potentie voor optoppen en dus hoe hoger de score.

Appartementencomplexen bestaan vaak uit meerdere BAG3D-pandobjecten met verschillende dakvlakken, hoogtes en hellingshoeken. Daarom wordt het daktype niet alleen op pandniveau bepaald, maar ook op complexniveau. De relevante dakvlakken worden per complex bij elkaar opgeteld. Het aandeel platte dakvlakken wordt daarbij afzonderlijk meegenomen in het criterium **Dakoppervlakte**.

De classificatie is gebaseerd op de BAG3D LOD2.2-dakvlakken. Deze dakvlakken zijn massaal ingewonnen en kunnen kleine meet- of segmentatiefouten bevatten. Daarom worden dakvlakken kleiner dan 3% van het totale dakoppervlak als niet-relevant beschouwd. Een dakvlak met een hellingshoek van minder dan 10 graden wordt functioneel als plat aangemerkt.

De daktypen worden als volgt onderscheiden:

- **Plat:** alle relevante dakvlakken zijn plat en vormen één horizontaal dakvlak, of de standaarddeviatie van de hoogtes is kleiner dan 2 meter.
- **Plat meervoud:** alle relevante dakvlakken zijn plat, maar de hoogteverschillen zijn groter dan 2 meter.
- **Licht schuin:** het dak bevat dakvlakken met een beperkte hellingshoek.
- **Schuin/speciaal:** het dak bevat relevante schuine dakvlakken of heeft een bijzondere dakvorm.

De daktypescore wordt als volgt toegekend:

| Daktype | Score |
|---|---:|
| Plat | 1 |
| Plat meervoud | 0,75 |
| Licht schuin | 0,5 |
| Schuin/speciaal | 0 |

Hoe meer plat dakoppervlak binnen een complex aanwezig is, hoe groter de ruimte voor een optoplaag. Daarom wordt naast het daktype ook de totale oppervlakte van de relevante platte dakvlakken opgeteld per complex. De daktypescore en de score voor dakoppervlakte vullen elkaar daarmee aan.

Gebruikte data: [BAG3D LOD2.2 © 3DBAG by tudelft3d and 3DGI](https://docs.3dbag.nl/en/copyright)

<details markdown="1">
<summary>Technische uitleg</summary>

De classificatie gebruikt het aantal dakvlakken, de hellingshoek, het aandeel van ieder dakvlak in het totale dakoppervlak en de standaarddeviatie van de hoogtes. Na het verwijderen van dakvlakken met een aandeel kleiner dan 3% worden de relevante dakvlakken per `complexid` geaggregeerd.

Een dakvlak wordt als plat beschouwd wanneer de hellingshoek kleiner is dan 10 graden. Als alle relevante dakvlakken plat zijn, wordt vervolgens gekeken naar het aantal dakvlakken en het hoogteverschil:

1. Bij één relevant dakvlak wordt het dak als **plat** geclassificeerd.
2. Bij meerdere relevante dakvlakken wordt het dak als **plat** geclassificeerd wanneer de standaarddeviatie van de hoogtes kleiner is dan 2 meter.
3. Als de standaarddeviatie 2 meter of meer is, wordt het dak als **plat meervoud** geclassificeerd.
4. Zodra relevante schuine dakvlakken aanwezig zijn, wordt het dak als **licht schuin** of **schuin/speciaal** geclassificeerd.

De uitkomsten zijn in QGIS verkend en handmatig gevalideerd, met extra aandacht voor complexen aan de grenzen van de selectie. De decision tree is vervolgens in FME uitgevoerd op basis van BAG3D LOD2.2.

### Wiskundige notatie

Voor ieder relevant dakvlak \(j\) binnen complex \(c\) wordt eerst het aandeel in het totale dakoppervlak bepaald:

$$
p_{cj} = \frac{A_{cj}}{\sum_{k \in c} A_{ck}} \times 100
$$

Alleen dakvlakken waarvoor \(p_{cj} \geq 3\) worden meegenomen. Een dakvlak is plat wanneer:

$$
h_{cj} =
\begin{cases}
1 & \text{als } \alpha_{cj} < 10^\circ \\
0 & \text{als } \alpha_{cj} \geq 10^\circ
\end{cases}
$$

waarbij \(\alpha_{cj}\) de hellingshoek van dakvlak \(j\) is. De daktypescore \(S_{\mathrm{daktype}}\) wordt vervolgens bepaald door:

$$
S_{\mathrm{daktype}}(D_c) =
\begin{cases}
1 & \text{als } D_c = \text{plat} \\
0.75 & \text{als } D_c = \text{plat meervoud} \\
0.5 & \text{als } D_c = \text{licht schuin} \\
0 & \text{als } D_c = \text{schuin/speciaal}
\end{cases}
$$

</details>


### Dakoppervlakte
De score voor dakoppervlakte vertaalt het totale dakoppervlak van een complex naar de potentie voor optoppen. Een groter dakoppervlak betekent meer ruimte voor nieuwe woningen en dus een grotere kans op een rond te rekenen businesscase. De score loopt lineair op tot 1.000 m², waarna de maximale score is bereikt.

Omdat een appartementencomplex uit meerdere panden en dakvlakken kan bestaan, wordt de dakoppervlakte per `complexid` opgeteld. De score loopt lineair op tot 1.000 m². Boven deze grens is de maximale score bereikt. Een groter dakoppervlak verhoogt de score dus niet verder, omdat vanaf dit oppervlak voldoende ruimte wordt verondersteld voor een optopproject.

Gebruikte data: [BAG3D LOD2.2 © 3DBAG by tudelft3d and 3DGI](https://docs.3dbag.nl/en/copyright)

<details markdown="1">
<summary>Technische uitleg</summary>

De dakoppervlakte wordt in FME berekend op basis van de dakvlakken uit de BAG3D LOD2.2. Eerst wordt per dakvlak de oppervlakte bepaald. Daarna worden de oppervlaktes per `complexid` opgeteld en via een `FeatureJoiner` teruggezet op het complex.

De uiteindelijke waarde `dakoppervlakte` wordt afgerond op hele vierkante meters. Als de dakoppervlakte ontbreekt of niet kan worden bepaald, krijgt het complex de waarde *onbekend* en wordt de score 0.

De dakoppervlaktescore wordt als volgt geïnterpreteerd:

1. Bij een dakoppervlakte tussen 0 en 1.000 m² loopt de score lineair op.
2. Bij een dakoppervlakte groter dan 1.000 m² is de score 1.
3. Bij een ontbrekende of onbekende dakoppervlakte is de score 0.

### Wiskundige notatie

De totale dakoppervlakte van complex \(c\) wordt berekend als de som van de relevante dakvlakken:

$$
A_c = \sum_{j \in c} A_{cj}
$$

waarbij \(A_{cj}\) de oppervlakte van dakvlak \(j\) binnen complex \(c\) is. De dakoppervlaktescore \(S_{\mathrm{dakoppervlakte}}\) wordt vervolgens berekend met:

$$
S_{\mathrm{dakoppervlakte}}(A_c) =
\begin{cases}
0 & \text{als } A_c \text{ onbekend is} \\
0 & \text{als } A_c \leq 0 \\
\operatorname{round}\left(\frac{A_c}{1000}, 2\right) & \text{als } 0 < A_c \leq 1000 \\
1 & \text{als } A_c > 1000
\end{cases}
$$

De score is daarmee begrensd op het interval \([0,1]\).

</details>

### Vrij dakpercentage
Dit criterium geeft aan welk deel van het dak vrij en bruikbaar is voor toevoeging van bouwvolume. Een hoger vrij dakpercentage betekent meer effectieve ruimte voor een optoplaag en leidt daarom tot een hogere score.

Met beeldherkenning worden obstakels op het dak opgespoord, zoals dakkapellen, schoorstenen, zonnepanelen en installaties. De voorspelde obstakelvlakken worden per complex samengevoegd en van het referentieoppervlak afgeknipt. Het overblijvende oppervlak wordt beschouwd als vrije dakoppervlakte.

De berekening wordt uitgevoerd op complexniveau. Hierdoor worden de dakvlakken en de voorspelde obstakels van meerdere panden binnen één appartementencomplex gezamenlijk beoordeeld. Dit voorkomt dat een complex met meerdere afzonderlijke dakvlakken voor ieder pand afzonderlijk wordt beoordeeld.

Het vrij dakpercentage wordt uitgedrukt als het aandeel van het vrije dakoppervlak ten opzichte van het totale dakoppervlak. De score loopt daardoor van 0 tot 1 en is gelijk aan het vrij dakpercentage gedeeld door 100.

Gebruikte data: [Beeldmateriaal 8cm orthofoto's 2024](https://www.beeldmateriaal.nl/)
**notitie: ** het beeldherkenningsmodel is nog in ontwikkeling en nog niet gepubliceerd. Via [deze link](https://webmap.hu.nl/nl/app/Dakenmodel) is een demo van de resultaten voor gemeente Utrecht te bekijken.  

<details markdown="1">
<summary>Technische uitleg</summary>

In FME worden de voorspellingen uit het beeldherkenningsmodel eerst per groep samengevoegd. Vervolgens worden de oppervlakten van het oorspronkelijke referentieoppervlak en het oppervlak buiten de voorspelde obstakels berekend.

Het oppervlak buiten de voorspellingen wordt gebruikt als vrije dakoppervlakte. Wanneer geen voorspeld obstakel het referentieoppervlak overlapt, wordt 80% van het oorspronkelijke oppervlak als vrije oppervlakte gebruikt. Deze correctie voorkomt dat een ontbrekende modelvoorspelling automatisch leidt tot een vrij dakpercentage van 100%.

Het attribuut `Vrij dak percentage` wordt afgerond op hele procentpunten en vervolgens weergegeven met twee decimalen. De `vrijdakoppervlakte_score` wordt berekend door dit percentage door 100 te delen.

### Wiskundige notatie

Voor ieder complex \(c\) definiëren we:

- \(A_c^{\mathrm{orig}}\): het oorspronkelijke referentieoppervlak;
- \(A_c^{\mathrm{vrij}}\): het oppervlak buiten de voorspelde obstakels;
- \(P_c^{\mathrm{vrij}}\): het vrij dakpercentage;
- \(S_c^{\mathrm{vrij}}\): de score voor het vrij dakpercentage.

Wanneer er voorspelde obstakels aanwezig zijn, wordt de vrije dakoppervlakte bepaald door:

$$
A_c^{\mathrm{vrij}} =
A_c^{\mathrm{orig}} -
A_c^{\mathrm{obstakels}}
$$

Wanneer geen obstakelvlak overlapt met het referentieoppervlak, wordt een correctiefactor van 0,80 toegepast:

$$
A_c^{\mathrm{vrij}} =
0.80 \times A_c^{\mathrm{orig}}
$$

Het vrij dakpercentage en de bijbehorende score worden vervolgens berekend met:

$$
P_c^{\mathrm{vrij}} =
\operatorname{round}\left(
\frac{A_c^{\mathrm{vrij}}}{A_c^{\mathrm{orig}}}
\times 100,\ 0
\right)
$$

$$
S_c^{\mathrm{vrij}} =
\frac{P_c^{\mathrm{vrij}}}{100}
$$

De score is daarmee begrensd op het interval \([0,1]\), waarbij een score van 1 overeenkomt met een vrij dakpercentage van 100%.

</details>

### Beschikbare bouwhoogte
Dit criterium geeft aan hoeveel verticale ruimte er volgens het bestemmingsplan beschikbaar is voor optoppen. De beschikbare bouwhoogte wordt bepaald door de maximale toegestane bouwhoogte te vergelijken met de huidige hoogte van het dakvlak.

We kijken naar het aandeel van het dakoppervlak waarvoor minimaal 3 meter vrije hoogte beschikbaar is. De score wordt per appartementencomplex bepaald en is oppervlaktegewogen: grote dakvlakken tellen zwaarder mee dan kleine dakvlakken.

De maximale bouwhoogte, maximale goothoogte en het maximale aantal bouwlagen worden opgehaald uit de maatvoeringslaag van de ruimtelijke plannen. De huidige bouwhoogte wordt bepaald op basis van de BAG3D-hoogtegegevens.

In de berekening wordt een planologische speling van 10% toegepast. Deze marge sluit aan bij de praktijk, waarin de beschikbare bouwhoogte niet altijd exact als harde grens wordt toegepast. De juridische betekenis van een beheersverordening voor dakopbouwen is niet eenduidig en wordt daarom niet afzonderlijk in de score verwerkt.

**Notitie:** Maak gebruik van de laag "vrije hoogte per dakvlak" om naast de score inzicht te krijgen in welke delen van het dakvlak geschikt zijn voor optoppen.

<details markdown="1">
<summary>Technische uitleg</summary>

Voor ieder dakvlak wordt eerst de maximale toegestane hoogte bepaald. Als een maximale bouwhoogte beschikbaar is, wordt deze gebruikt. Als alternatief worden het maximale aantal bouwlagen of de maximale goothoogte gebruikt. Op de gevonden planologische maat wordt een marge van 10% toegepast.

De beschikbare hoogte (`vrijehoogte`) wordt vervolgens berekend als het verschil tussen de planologische hoogte en de huidige hoogte van het dakvlak. Hierbij wordt rekening gehouden met de hoogte van het maaiveld. Dakvlakken met een vrije hoogte van minimaal 3 meter worden als geschikt aangemerkt voor een mogelijke optopping. Dakvlakken met minder dan 3 meter vrije hoogte krijgen een ongeschikte score.

De oppervlakte van geschikte en ongeschikte dakvlakken wordt per `complexid` opgeteld. De uiteindelijke score is het aandeel van het geschikte dakoppervlak in het totale beoordeelde dakoppervlak. Wanneer geen bestemmingsplan of maatvoering beschikbaar is, krijgt het dakvlak en daarmee het complex momenteel score 0.

### Wiskundige notatie

Voor ieder dakvlak \(i\) definiëren we:

- \(H_i^{\mathrm{plan}}\): de maximale planologische hoogte;
- \(H_i^{\mathrm{huidig}}\): de huidige hoogte van het dakvlak;
- \(A_i\): de oppervlakte van het dakvlak;
- \(V_i\): de beschikbare vrije hoogte.

De planologische hoogte wordt bepaald met een marge van 10%:

$$
H_i^{\mathrm{plan}} =
\begin{cases}
1.1 \times H_i^{\mathrm{maxbouwhoogte}} & \text{als maximale bouwhoogte beschikbaar is} \\
1.1 \times (3 \times L_i^{\mathrm{max}}) & \text{als maximaal aantal bouwlagen beschikbaar is} \\
1.1 \times H_i^{\mathrm{maxgoothoogte}} & \text{als maximale goothoogte beschikbaar is}
\end{cases}
$$

De vrije hoogte van het dakvlak is:

$$
V_i = H_i^{\mathrm{plan}} - H_i^{\mathrm{huidig}}
$$

Een dakvlak is geschikt wanneer:

$$
G_i =
\begin{cases}
1 & \text{als } V_i \geq 3 \text{ meter} \\
0 & \text{als } V_i < 3 \text{ meter of de planologische hoogte ontbreekt}
\end{cases}
$$

De score voor complex \(c\) wordt oppervlaktegewogen berekend met:

$$
S_{\mathrm{vrijehoogte},c}
=
\operatorname{round}\left(
\frac{\sum_{i \in c} A_i G_i}
{\sum_{i \in c} A_i},
2
\right)
$$

De score ligt daarmee tussen 0 en 1 en kan ook worden gelezen als het percentage dakoppervlak met minimaal 3 meter vrije hoogte, gedeeld door 100.

</details>

### Bestaande bouwhoogte
De score voor bestaande bouwhoogte geeft aan hoe hoog het appartementencomplex al is voordat een optoplaag wordt toegevoegd. Hoe hoger het bestaande gebouw, hoe lager de score.

Een grotere bouwhoogte kan de constructieve en bouwkundige complexiteit vergroten. Ook kunnen langere vluchtwegen, windbelasting en strengere voorschriften een rol spelen. Tegelijkertijd kan bij hogere appartementencomplexen al een lift of gemeenschappelijke ontsluiting aanwezig zijn. 

De hoogte wordt bepaald op basis van de 3DBAG-hoogtegegevens. Voor ieder dakvlak wordt de hoogte ten opzichte van het maaiveld berekend. Vervolgens wordt per appartementencomplex een oppervlaktegewogen gemiddelde bepaald. Grote dakvlakken hebben daardoor meer invloed op de complexwaarde dan kleine dakvlakken.

De score verloopt lineair tussen 0 en 30 meter. Boven 30 meter krijgt het complex score 0.

Gebruikte data: [3DBAG LOD2.2 © 3DBAG by tudelft3d and 3DGI](https://docs.3dbag.nl/en/copyright)

<details markdown="1">
<summary>Technische uitleg</summary>

De brondata voor de gebouwhoogte bestaat uit LOD2.2 dakvlakken uit de 3DBAG en de bijbehorende maaiveldhoogte. In de praktijk kunnen fouten voorkomen in de afgeleide bouwlagen: hoge flats kunnen bijvoorbeeld ten onrechte als gebouw met één of twee bouwlagen worden geregistreerd. Daarom wordt voor deze berekening de gemeten hoogte gebruikt in plaats van uitsluitend het geregistreerde aantal bouwlagen.

Voor ieder dakvlak wordt de absolute hoogte berekend door de maaiveldhoogte van de dakvlakhoogte af te trekken. Daarna wordt per `complexid` het oppervlaktegewogen gemiddelde van deze hoogtes bepaald. De uiteindelijke waarde `hoogte` wordt afgerond en als complexattribuut opgeslagen.

De score wordt als volgt berekend:

1. Bij een ontbrekende of niet-positieve hoogte is de score 0.
2. Tussen 0 en 30 meter daalt de score lineair naarmate de hoogte toeneemt.
3. Bij een hoogte van 30 meter of meer is de score 0.

De grens van 30 meter is gekozen als indicatie voor de overgang naar hogere bebouwing, waarbij strengere bouwkundige en veiligheidskundige eisen kunnen gelden. De scoregewichten en grenswaarden kunnen in een volgende iteratie worden aangepast op basis van overleg met het optopteam.

### Wiskundige notatie

Voor ieder dakvlak \(i\) binnen complex \(c\) definiëren we:

- \(A_i\): de oppervlakte van het dakvlak;
- \(Z_i\): de absolute hoogte van het dakvlak;
- \(M_i\): de maaiveldhoogte bij het dakvlak;
- \(H_i\): de hoogte van het dakvlak ten opzichte van het maaiveld.

De hoogte van ieder dakvlak wordt berekend met:

$$
H_i = Z_i - M_i
$$

De bestaande bouwhoogte van complex \(c\) is het oppervlaktegewogen gemiddelde:

$$
H_c =
\frac{\sum_{i \in c} A_i H_i}
{\sum_{i \in c} A_i}
$$

De score voor bestaande bouwhoogte wordt vervolgens bepaald met:

$$
S_{\mathrm{bouwhoogte}}(H_c) =
\begin{cases}
0 & \text{als } H_c \text{ ontbreekt of } H_c \leq 0 \\
\operatorname{round}\left(\frac{30 - H_c}{30}, 2\right) & \text{als } 0 < H_c < 30 \\
0 & \text{als } H_c \geq 30
\end{cases}
$$

De score ligt daarmee tussen 0 en 1. Een score van 1 correspondeert met een zeer lage bestaande bouwhoogte en een score van 0 met een ontbrekende, niet-positieve of zeer hoge bouwhoogte.

</details>

### Vrije ruimte perceel
Dit criterium beoordeelt hoeveel horizontale ruimte rondom het complex beschikbaar is voor een optopproject. Daarbij wordt gekeken naar de ruimte op het perceel buiten een buffer van 25 meter rond het appartementencomplex.

De vrije ruimte zegt iets over:

- ruimte voor een nieuwe ontsluiting (trappenhuis/lift)
- mogelijkheid voor extra parkeerplaatsen op eigen terrein
- kans op extra schaduwval op omliggende bebouwing
- ruimte voor bouwplaatsinrichting

Een groter vrij oppervlak biedt meer mogelijkheden voor de inrichting van een optopproject en leidt daarom tot een hogere score. De score verloopt lineair tussen 1.000 en 5.000 m². Onder 1.000 m² is de score 0; boven 5.000 m² is de maximale score bereikt.

De vrije ruimte wordt per `complexid` bepaald. Wanneer een appartementencomplex uit meerdere panden bestaat, worden de relevante perceeldelen gezamenlijk beoordeeld. De oppervlakte wordt afgerond op twee decimalen.

<details markdown="1">
<summary>Technische uitleg</summary>

In FME wordt eerst een buffer van 25 meter rond ieder appartementencomplex gemaakt. Deze buffer representeert de directe ruimte rondom het gebouw. Vervolgens worden de perceelgeometrieën met deze buffer geknipt. De perceeldelen buiten de buffer worden beschouwd als vrije ruimte die mogelijk kan worden gebruikt voor de inrichting van een optopproject.

De overgebleven perceeldelen worden per `complexid` samengevoegd en hun oppervlakte wordt berekend. Daardoor kunnen meerdere percelen of perceeldelen binnen één complex gezamenlijk meetellen.

De score wordt als volgt berekend:

1. Bij minder dan of gelijk aan 1.000 m² vrije ruimte is de score 0.
2. Tussen 1.000 en 5.000 m² loopt de score lineair op.
3. Bij meer dan 5.000 m² is de score 1.
4. Bij ontbrekende vrije ruimte wordt de score 0.

### Wiskundige notatie

Voor ieder perceeldeel \(j\) dat bij complex \(c\) hoort, definiëren we \(A_{cj}\) als de oppervlakte buiten de buffer van 25 meter. De totale vrije ruimte van complex \(c\) is:

$$
A_c^{\mathrm{vrij}} =
\sum_{j \in c} A_{cj}
$$

De score voor vrije ruimte op het perceel wordt vervolgens berekend met:

$$
S_{\mathrm{vrije ruimte},c} =
\begin{cases}
0 & \text{als } A_c^{\mathrm{vrij}} \text{ ontbreekt of } A_c^{\mathrm{vrij}} \leq 1000 \\
\operatorname{round}\left(
\frac{A_c^{\mathrm{vrij}} - 1000}{4000},\ 2
\right) & \text{als } 1000 < A_c^{\mathrm{vrij}} \leq 5000 \\
1 & \text{als } A_c^{\mathrm{vrij}} > 5000
\end{cases}
$$

De score ligt daarmee tussen 0 en 1. Een score van 1 betekent dat minimaal 5.000 m² vrije ruimte buiten de buffer beschikbaar is.

</details>

### Energielabel
De energielabelscore geeft aan hoeveel verduurzamingspotentie er nog in een appartementencomplex zit bij een optopproject. Hoe beter het huidige energielabel, hoe lager de score: bij een al energiezuinig gebouw is de extra verduurzamingswinst van een gecombineerd renovatie- en optoptraject doorgaans kleiner.

Voor een complex met meerdere panden bepalen we eerst één representatief energielabel op complexniveau. Daarbij gebruiken we de meest voorkomende energieklasse binnen het complex. Zo wegen incidentele uitzonderingen minder zwaar dan het dominante beeld. De energielabelgegevens zijn afkomstig uit EP-online. Het oorspronkelijke bouwjaar uit de BAG wordt als vangnet gebruikt wanneer geen bruikbaar energielabel beschikbaar is.

De energielabelscore wordt als volgt toegekend:

| Energielabel | Score |
|---|---:|
| A | 0 |
| B | 0,2 |
| C | 0,4 |
| D | 0,6 |
| E | 0,8 |
| F of G | 1 |
| Ontbrekend en gemiddeld bouwjaar \(\leq\) 1992 | 1 |
| Ontbrekend en gemiddeld bouwjaar \(>\) 1992 of onbekend | 0 |

Een hoge score betekent dat er naar verwachting meer verduurzamingspotentie aanwezig is. De score is een indicatie en zegt niet zelfstandig welke maatregelen technisch of financieel het meest geschikt zijn.

<details markdown="1">
<summary>Technische uitleg</summary>

In FME wordt met een `StatisticsCalculator` per `complexid` de **mode** van `energieklasse` berekend (`energieklasse.mode`). Deze meest voorkomende energieklasse wordt via een `FeatureJoiner` teruggezet op het complex en opgeslagen als `energielabel`.

Naast het energielabel wordt een bouwjaarvangnet berekend. Daarvoor worden de oorspronkelijke bouwjaren per complex gemiddeld. Panden met de status *Pand in gebruik* worden in deze aanvullende berekening uitgesloten; overige beschikbare pandstatussen blijven beschikbaar voor het bepalen van het gemiddelde. Wanneer het energielabel ontbreekt en het gemiddelde bouwjaar maximaal 1992 is, wordt de score 1 toegekend. In alle andere gevallen zonder bruikbaar label is de score 0.

In de eindoutput blijven alleen `energielabel_score`, `complexid` en `energielabel` over.

### Wiskundige notatie

Voor complex \(c\) definiëren we:

- \(L_c\): het representatieve energielabel, oftewel de mode van de beschikbare labels;
- \(Y_c\): het gemiddelde oorspronkelijke bouwjaar;
- \(S_{\mathrm{energielabel},c}\): de energielabelscore.

Het representatieve energielabel wordt bepaald met:

$$
L_c = \operatorname{mode}\left(\{L_i \mid i \in c\}\right)
$$

De score wordt vervolgens berekend met:

$$
S_{\mathrm{energielabel}}(L_c,Y_c) =
\begin{cases}
0 & \text{als } L_c=\mathrm{A} \\
0.2 & \text{als } L_c=\mathrm{B} \\
0.4 & \text{als } L_c=\mathrm{C} \\
0.6 & \text{als } L_c=\mathrm{D} \\
0.8 & \text{als } L_c=\mathrm{E} \\
1 & \text{als } L_c\in\{\mathrm{F},\mathrm{G}\} \\
1 & \text{als } L_c\text{ ontbreekt en }Y_c\leq 1992 \\
0 & \text{anders}
\end{cases}
$$

De score ligt daarmee tussen 0 en 1. Een score van 0 staat voor een zeer goed energielabel of onvoldoende informatie voor een positieve vangnetscore. Een score van 1 staat voor energielabel F of G, of voor een ontbrekend label bij een gemiddeld bouwjaar tot en met 1992.

</details>

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