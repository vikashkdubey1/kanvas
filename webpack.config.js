const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  entry: './src/index.tsx',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js',
  },
  module: {
      rules: [
          {
              test: /\.tsx?$/,
              exclude: /node_modules/,
              use: 'ts-loader',
          },
          {
              test: /\.(js|jsx)$/,
              exclude: /node_modules/,
              use: {
                  loader: 'babel-loader',
                  options: {
                  presets: ['@babel/preset-env', '@babel/preset-react'],
                  },
              },
          },
          {
              test: /\.module\.css$/,
              use: [
                  'style-loader',
                  {
                      loader: 'css-loader',
                      options: {
                          modules: true,
                          esModule: true,
                      },
                  },
              ],
          },
          {
              test: /\.css$/,
              exclude: /\.module\.css$/,
              use: ['style-loader', 'css-loader'],
          },
      ],
  },
  resolve: {
      extensions: ['.js', '.jsx', '.ts', '.tsx'],
      alias: {
          react: path.resolve(__dirname, 'node_modules/react'),
          'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
          'react-dom/client': path.resolve(
              __dirname,
              'node_modules/react-dom/client.js'
          ),
          'react/jsx-runtime': path.resolve(
              __dirname,
              'node_modules/react/jsx-runtime.js'
          ),
      },
  },
 plugins: [
    new HtmlWebpackPlugin({
      template: './public/index.html',
    }),
  ],
  devServer: {
    static: './public',
    hot: true,
    port: 3000,
  },
};
