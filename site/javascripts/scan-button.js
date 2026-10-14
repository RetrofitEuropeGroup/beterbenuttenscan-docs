document$.subscribe(function () {
  var search = document.querySelector(".md-search");

  if (!search || search.parentElement.querySelector(".scan-link")) {
    return;
  }

  var link = document.createElement("a");
  link.className = "scan-link md-button";
  link.href = "https://pimplatform.nl/";
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = "Naar de scan";

  search.parentElement.insertBefore(link, search);
});
