module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
    // Reanimated 4 ships the worklets plugin separately; it MUST stay last.
    plugins: ["react-native-worklets/plugin"],
  };
};
