const accordions = document.querySelectorAll(".accordion");

accordions.forEach((accordion) => {
    const header = accordion.querySelector(".accordion-header");

    header.addEventListener("click", () => {
        accordion.classList.toggle("active");
    });
});

const toggles = document.querySelectorAll(".toggle");

toggles.forEach((toggle) => {
    toggle.addEventListener("click", () => {
        toggle.classList.toggle("active");
    });
});
