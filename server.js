const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3001;

// Определяем окружение
const isDevelopment = process.env.NODE_ENV !== 'production';

// Middleware
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:3001',
    // Ваш актуальный домен Netlify
    'https://vermillion-phoenix-d0dfc1.netlify.app',
    // Ваш актуальный Railway домен
    'https://db-test-production-e7f7.up.railway.app',
  ],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Пути к папкам (исправленные для структуры с backend папкой)
const newsAssetsPath = path.join(__dirname, "../src/assets/news");
const newsConfigPath = path.join(__dirname, "../src/config/newsConfig.ts");

// Создаем папки если их нет
if (!fs.existsSync(newsAssetsPath)) {
  fs.mkdirSync(newsAssetsPath, { recursive: true });
}

if (!fs.existsSync(path.dirname(newsConfigPath))) {
  fs.mkdirSync(path.dirname(newsConfigPath), { recursive: true });
}

// Создаем начальный файл конфигурации если его нет
if (!fs.existsSync(newsConfigPath)) {
  const initialConfig = `export interface NewsItem {
  id: number;
  title: string;
  date: string;
  description: string;
  image: string;
  fullText: string;
  media?: string[];
}

export const newsConfig: NewsItem[] = [
  // Здесь будут автоматически добавляться новости через админку
];
`;
  fs.writeFileSync(newsConfigPath, initialConfig, "utf8");
}

// Настройка multer для загрузки файлов
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, newsAssetsPath);
  },
  filename: (req, file, cb) => {
    // Генерируем уникальное имя файла
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `news-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Только изображения разрешены!"), false);
    }
  }
});

// Функция для чтения текущих новостей из конфига
function readNewsConfig() {
  try {
    const configContent = fs.readFileSync(newsConfigPath, "utf8");

    // Извлекаем массив новостей из файла
    const arrayMatch = configContent.match(
      /export const newsConfig: NewsItem\[\] = \[([\s\S]*?)\];/
    );

    if (!arrayMatch) {
      return [];
    }

    const arrayContent = arrayMatch[1].trim();
    if (
      !arrayContent ||
      arrayContent ===
        "// Здесь будут автоматически добавляться новости через админку"
    ) {
      return [];
    }

    // Простой парсинг объектов (убрали теги)
    const newsItems = [];
    const objectRegex =
      /\{\s*id:\s*(\d+),\s*title:\s*'([^']+)',\s*date:\s*'([^']+)',\s*description:\s*'([^']+)',\s*image:\s*'([^']+)',\s*fullText:\s*'([^']+)'(?:,\s*media:\s*\[([^\]]*)\])?\s*\}/g;

    let match;
    while ((match = objectRegex.exec(arrayContent)) !== null) {
      const [, id, title, date, description, image, fullText, mediaStr] = match;
      const media = mediaStr
        ? mediaStr
            .split(",")
            .map((mediaPath) => mediaPath.trim().replace(/'/g, ""))
        : [];

      newsItems.push({
        id: parseInt(id),
        title,
        date,
        description,
        image,
        fullText,
        media: media.length > 0 ? media : undefined
      });
    }

    return newsItems;
  } catch (error) {
    console.error("Ошибка чтения конфига:", error);
    return [];
  }
}

// Функция для записи новостей в конфиг
function writeNewsConfig(newsItems) {
  try {
    const newsItemsString = newsItems
      .map((item) => {
        const mediaString =
          item.media && item.media.length > 0
            ? `, media: [${item.media
                .map((mediaPath) => `'${mediaPath}'`)
                .join(", ")}]`
            : "";

        return `  {
    id: ${item.id},
    title: '${item.title}',
    date: '${item.date}',
    description: '${item.description}',
    image: '${item.image}',
    fullText: '${item.fullText}'${mediaString}
  }`;
      })
      .join(",\n");

    const configContent = `export interface NewsItem {
  id: number;
  title: string;
  date: string;
  description: string;
  image: string;
  fullText: string;
  media?: string[];
}

export const newsConfig: NewsItem[] = [
${newsItemsString}
];
`;

    fs.writeFileSync(newsConfigPath, configContent, "utf8");
    console.log("Конфиг успешно обновлен");
  } catch (error) {
    console.error("Ошибка записи конфига:", error);
    throw error;
  }
}

// API маршруты

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Получить все новости
app.get("/api/news", (req, res) => {
  try {
    const news = readNewsConfig();
    res.json(news);
  } catch (error) {
    res.status(500).json({ error: "Ошибка чтения новостей" });
  }
});

// Добавить новость
app.post(
  "/api/news",
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "media", maxCount: 20 }
  ]),
  (req, res) => {
    try {
      const { title, description, fullText } = req.body;

      if (
        !title ||
        !description ||
        !fullText ||
        !req.files ||
        !req.files.image
      ) {
        return res
          .status(400)
          .json({ error: "Заполните все обязательные поля" });
      }

      // Получаем текущие новости
      const currentNews = readNewsConfig();

      // Генерируем новый ID
      const newId =
        currentNews.length > 0
          ? Math.max(...currentNews.map((item) => item.id)) + 1
          : 1;

      // Обрабатываем главное изображение
      const mainImage = req.files.image[0];

      // Обрабатываем дополнительные изображения
      const mediaFiles = req.files.media || [];
      const mediaArray = mediaFiles.map(
        (file) => `/src/assets/news/${file.filename}`
      );

      // Создаем новую новость
      const newNewsItem = {
        id: newId,
        title,
        date: new Date().toISOString().split("T")[0], // YYYY-MM-DD формат
        description,
        image: `/src/assets/news/${mainImage.filename}`, // Полный путь к главному изображению
        fullText,
        media: mediaArray.length > 0 ? mediaArray : undefined
      };

      // Добавляем новость в массив
      const updatedNews = [...currentNews, newNewsItem];

      // Записываем обновленный конфиг
      writeNewsConfig(updatedNews);

      res.json({
        success: true,
        news: newNewsItem,
        message: "Новость успешно добавлена"
      });
    } catch (error) {
      console.error("Ошибка добавления новости:", error);

      // Удаляем загруженные файлы в случае ошибки
      if (req.files) {
        const allFiles = [
          ...(req.files.image || []),
          ...(req.files.media || [])
        ];
        allFiles.forEach((file) => {
          fs.unlink(file.path, (unlinkError) => {
            if (unlinkError)
              console.error("Ошибка удаления файла:", unlinkError);
          });
        });
      }

      res.status(500).json({ error: "Ошибка добавления новости" });
    }
  }
);

// Удалить новость
app.delete("/api/news/:id", (req, res) => {
  try {
    const newsId = parseInt(req.params.id);

    if (isNaN(newsId)) {
      return res.status(400).json({ error: "Неверный ID новости" });
    }

    // Получаем текущие новости
    const currentNews = readNewsConfig();

    // Находим новость для удаления
    const newsToDelete = currentNews.find((item) => item.id === newsId);

    if (!newsToDelete) {
      return res.status(404).json({ error: "Новость не найдена" });
    }

    // Удаляем файл главного изображения
    const imagePath = path.join(
      newsAssetsPath,
      path.basename(newsToDelete.image)
    );
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }

    // Удаляем файлы дополнительных изображений
    if (newsToDelete.media && newsToDelete.media.length > 0) {
      newsToDelete.media.forEach((mediaPath) => {
        const mediaFilePath = path.join(
          newsAssetsPath,
          path.basename(mediaPath)
        );
        if (fs.existsSync(mediaFilePath)) {
          fs.unlinkSync(mediaFilePath);
        }
      });
    }

    // Удаляем новость из массива
    const updatedNews = currentNews.filter((item) => item.id !== newsId);

    // Записываем обновленный конфиг
    writeNewsConfig(updatedNews);

    res.json({
      success: true,
      message: "Новость успешно удалена"
    });
  } catch (error) {
    console.error("Ошибка удаления новости:", error);
    res.status(500).json({ error: "Ошибка удаления новости" });
  }
});

// Статические файлы для изображений
app.use("/src/assets/news", express.static(newsAssetsPath));

// Обработка ошибок multer
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res
        .status(400)
        .json({ error: "Файл слишком большой (максимум 5MB)" });
    }
  }

  if (error.message === "Только изображения разрешены!") {
    return res.status(400).json({ error: error.message });
  }

  res.status(500).json({ error: "Внутренняя ошибка сервера" });
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`🚀 Backend сервер запущен на порту ${PORT}`);
  console.log(`🌍 Режим: ${isDevelopment ? 'development' : 'production'}`);
  console.log(`📁 Папка для изображений: ${newsAssetsPath}`);
  console.log(`⚙️ Файл конфигурации: ${newsConfigPath}`);
  console.log(`🌐 API доступно по адресу: http://localhost:${PORT}/api`);
  console.log(`❤️ Health check: http://localhost:${PORT}/api/health`);
});
