(function () {
  // Carousel logic
  const items = document.querySelectorAll(".carousel-item");
  const dots = document.querySelectorAll(".dot");
  let currentIndex = 0;

  function showSlide(index) {
    items.forEach((item, i) => {
      item.classList.toggle("active", i === index);
      dots[i].classList.toggle("active", i === index);
    });
  }

  function nextSlide() {
    currentIndex = (currentIndex + 1) % items.length;
    showSlide(currentIndex);
  }

  function prevSlide() {
    currentIndex = (currentIndex - 1 + items.length) % items.length;
    showSlide(currentIndex);
  }

  let slideInterval = setInterval(nextSlide, 5000);

  function resetInterval() {
    clearInterval(slideInterval);
    slideInterval = setInterval(nextSlide, 5000);
  }

  document.getElementById("next-btn").addEventListener("click", () => {
    nextSlide();
    resetInterval();
  });

  document.getElementById("prev-btn").addEventListener("click", () => {
    prevSlide();
    resetInterval();
  });

  dots.forEach((dot, index) => {
    dot.addEventListener("click", () => {
      currentIndex = index;
      showSlide(currentIndex);
      resetInterval();
    });
  });

  // Language logic (using shared logic from shared.js)
  const langToggle = document.getElementById("lang-toggle");
  if (langToggle && window.PrimeLab) {
    langToggle.addEventListener("click", () => {
      const newLang = PrimeLab.getLang() === "vi" ? "en" : "vi";
      PrimeLab.setLang(newLang);
    });
    PrimeLab.applyTranslations();
    PrimeLab.initChatbotWidget?.();
  }
})();
