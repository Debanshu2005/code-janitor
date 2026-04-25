/**
 * Test YouTube ID extraction logic (Node.js)
 * This validates the logic without needing a browser
 */

function extractYouTubeId(url) {
  var cleanUrl = String(url || "").trim();
  if (!cleanUrl) return null;
  
  var patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})(?:[&\s]|$)/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})(?:[?\s]|$)/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})(?:[?\s]|$)/,
    /(?:youtube\.com\/v\/)([a-zA-Z0-9_-]{11})(?:[?\s]|$)/
  ];
  
  for (var i = 0; i < patterns.length; i++) {
    var match = cleanUrl.match(patterns[i]);
    if (match && match[1]) {
      var videoId = match[1];
      if (videoId.length === 11 && /^[a-zA-Z0-9_-]+$/.test(videoId)) {
        return videoId;
      }
    }
  }
  return null;
}

function makeYouTubeEmbedUrl(videoId) {
  return "https://www.youtube.com/embed/" + videoId;
}

// Test cases
const testCases = [
  {
    name: "Standard YouTube URL",
    url: "https://www.youtube.com/watch?v=PkZNo7MFNFg",
    expectedId: "PkZNo7MFNFg",
    expectedEmbed: "https://www.youtube.com/embed/PkZNo7MFNFg"
  },
  {
    name: "Short URL (youtu.be)",
    url: "https://youtu.be/Ke90Tje7VS0",
    expectedId: "Ke90Tje7VS0",
    expectedEmbed: "https://www.youtube.com/embed/Ke90Tje7VS0"
  },
  {
    name: "URL with parameters",
    url: "https://www.youtube.com/watch?v=_uQrJ0TkZlc&feature=share",
    expectedId: "_uQrJ0TkZlc",
    expectedEmbed: "https://www.youtube.com/embed/_uQrJ0TkZlc"
  },
  {
    name: "URL with whitespace",
    url: "   https://www.youtube.com/watch?v=PkZNo7MFNFg   ",
    expectedId: "PkZNo7MFNFg",
    expectedEmbed: "https://www.youtube.com/embed/PkZNo7MFNFg"
  },
  {
    name: "Embed URL",
    url: "https://www.youtube.com/embed/bMknfKXIFA8",
    expectedId: "bMknfKXIFA8",
    expectedEmbed: "https://www.youtube.com/embed/bMknfKXIFA8"
  },
  {
    name: "Invalid URL",
    url: "invalid url",
    expectedId: null,
    expectedEmbed: null
  },
  {
    name: "Invalid video ID (too short)",
    url: "https://www.youtube.com/watch?v=SHORT",
    expectedId: null,
    expectedEmbed: null
  },
  {
    name: "Invalid video ID (too long)",
    url: "https://www.youtube.com/watch?v=TOOLONGID123",
    expectedId: null,
    expectedEmbed: null
  },
  {
    name: "Empty string",
    url: "",
    expectedId: null,
    expectedEmbed: null
  },
  {
    name: "Null input",
    url: null,
    expectedId: null,
    expectedEmbed: null
  }
];

console.log('\n🧪 Testing YouTube ID Extraction Logic\n');
console.log('='.repeat(80));

let passed = 0;
let failed = 0;

testCases.forEach((test, index) => {
  const extractedId = extractYouTubeId(test.url);
  const embedUrl = extractedId ? makeYouTubeEmbedUrl(extractedId) : null;
  
  const idMatch = extractedId === test.expectedId;
  const embedMatch = embedUrl === test.expectedEmbed;
  const testPassed = idMatch && embedMatch;
  
  if (testPassed) {
    passed++;
    console.log(`\n✅ Test ${index + 1}: ${test.name}`);
  } else {
    failed++;
    console.log(`\n❌ Test ${index + 1}: ${test.name}`);
  }
  
  console.log(`   Input:    ${test.url}`);
  console.log(`   Expected: ${test.expectedId || 'null'}`);
  console.log(`   Got:      ${extractedId || 'null'}`);
  
  if (!idMatch) {
    console.log(`   ⚠️  ID mismatch!`);
  }
  
  if (embedUrl) {
    console.log(`   Embed:    ${embedUrl}`);
    if (!embedMatch) {
      console.log(`   ⚠️  Embed URL mismatch!`);
    }
  }
});

console.log('\n' + '='.repeat(80));
console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${testCases.length} tests`);

if (failed === 0) {
  console.log('\n✅ All tests passed! The extraction logic is working correctly.');
  console.log('\n📝 Next steps:');
  console.log('   1. Reload VS Code or restart the Code Janitor extension');
  console.log('   2. Open Code Janitor AI Chat (Ctrl+Alt+C)');
  console.log('   3. Search YouTube for "javascript tutorial"');
  console.log('   4. Click a video link and verify it embeds without Error 153');
} else {
  console.log('\n❌ Some tests failed. The logic needs adjustment.');
}

console.log('\n');
