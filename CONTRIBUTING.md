### Contributing

We'd love for you to contribute to our source code and to make this project even better than it is today!

#### Submitting an Issue

If you've found an area whereby this project does not behave in a sensible or performant manner, then you can help us by submitting an issue to this repository. The more specific you can be, the better.

#### Submitting a Pull Request

All code in this project is developed around the example json:api implementation which can be found [here](https://github.com/holidayextras/jsonapi-server). You can fire up the stock example api backed with this data store via:
```
npm start
```

Every pull request that changes code in this project needs to either fix an existing tst case or have some form of regression test with it. That might take the shape of some additional asserts in key places within existing tests, it might involve new tests. We write tests to ensure features don't get lost - protect your feature by writing good tests!

To verify all the code changes pass our [JavaScript Standard Style](https://standardjs.com/) guidelines:
```
npm run lint
```

To verify everything still behaves as expected:
```
npm test
```

To check the code coverage is still great:
```
npm run coverage
google-chrome ./coverage.html
```

To see code complexity statistics:
```
npm run complexity
google-chrome ./complexity/index.html
```

If all of the above comes up good, go ahead and put in a pull request!
