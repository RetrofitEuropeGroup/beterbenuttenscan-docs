# Appartementencomplexen

De laag appartementencomplexen bevat geaggregeerde BAG Pand objecten en kan gebruikt worden voor de verdichtingsvormen optoppen, aanplakken en uitplinten. De laag is geaggregeerd omdat de BAG Pand objecten niet altijd overeenkomen met de manier waarop wij een appartementencomplex zien.

Als we bijv. de [definitie opzoeken van objecttype Pand in de BAG](https://imbag.github.io/praktijkhandleiding/beslisboomvragen_pand/pand-07):
> *Een pand moet ondeelbaar zijn en mag bij de totstandkoming niet kunnen worden opgedeeld in kleinere eenheden die elk afzonderlijk aan de definitie van een pand voldoen.*
> 

Dit zorgt ervoor dat een portiekflat volgens deze definitie wordt opgesplitst in meerdere BAG Pand objecten. De potentie van een optopproject is sterk afhankelijk van het aantal potentieel te realiseren woningen in een appartementencomplex. Daarom is het belangrijk dat de laag appartementencomplexen een betere representatie is van de werkelijkheid dan de losse BAG Pand objecten.

De manier van aggregatie is:

1. We selecteren eerst panden met een woonfunctie en groeperen de panden die vlak naast elkaar staan (binnen 2,5 meter) tot één aaneengesloten geheel. 
2. Vervolgens bepalen we of deze groep een appartementencomplex is op basis van het aantal woningen: een losstaand gebouw moet meer dan drie woningen bevatten, en een groep van meerdere panden moet gemiddeld meer dan 1,2 woningen per pand hebben.

### Code

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
