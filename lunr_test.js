const lunr = require('lunr');

function tokenizer(text) {

    const str = text.toString().toLowerCase()
    let tokens = []
    let len = str.length

    for (var sliceEnd = 0, sliceStart = 0; sliceEnd <= len; sliceEnd++) {

        var char = str.charAt(sliceEnd),
            sliceLength = sliceEnd - sliceStart

        if ((char.match(/[^\d\w]/) || sliceEnd == len)) {

            if (sliceLength > 0) {

                tokens.push(
                    str.slice(sliceStart, sliceEnd)
                )
            }

            sliceStart = sliceEnd + 1

        }

    }

    return tokens
}


a = 'asdasd asdas.10 - select/asd/as sdlas? asd:asdsda  @@@@  (sfd) asd|dfsd'

console.log(tokenizer(a))